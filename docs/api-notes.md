# DeepSeek API — Notes (M0)

**Izvor istine** za sve dalje faze (spec, [[deepseek-cli-development-plan]]).
Svaki nalaz ovde mora biti verifikovan protiv **živog API-ja** ili
**zvanične dokumentacije** — ništa iz blog postova ili tuđih repoa bez
sopstvene provere.

Status vrednosti: `☐ nije verifikovano` · `🔶 delimično / nejasno` · `✅ verifikovano`

---

## 1. Thinking mode i reasoning effort parametri

**Status:** ✅

- **OpenAI-kompatibilan format** (ovo koristimo, `/chat/completions`):
  ```json
  { "thinking": { "type": "enabled", "reasoning_effort": "low" } }
  ```
  Za isključivanje: `{"thinking": {"type": "disabled"}}`.
- **Anthropic-kompatibilan format** (drugi endpoint, nismo ga testirali):
  `{"reasoning": {"effort": "none/low/high/max"}}`.
- Dozvoljene vrednosti za `reasoning_effort`: **`low` / `high` / `max`**
  (NE `medium` — moja početna pretpostavka u kodu je bila pogrešna).
  `medium` i `xhigh` se i dalje prihvataju radi kompatibilnosti, ali se
  interno mapiraju na `high`.
  Default (ako se `thinking` izostavi): enabled, effort high.
- Kod thinking moda, `temperature`/`top_p`/`presence_penalty`/`frequency_penalty`
  se tiho ignorišu (ne baca grešku).
- Kod poziva sa `tools`, reasoning_content se pojavljuje **zajedno** sa
  `tool_calls` u istoj poruci — potvrđeno live testom.

**Nalaz:** implementirano u `src/deepseek/client.ts` i `src/deepseek/types.ts`
(`ThinkingConfig.reasoningEffort: "low" | "high" | "max"`).

**Izvor:** https://api-docs.deepseek.com/guides/thinking_mode/,
https://api-docs.deepseek.com/api/create-chat-completion/, live poziv (non-stream,
`deepseek-v4-flash`, `reasoning_effort: "low"`, 12*7 primer).
**Datum:** 2026-08-27

---

## 2. `reasoning_content` u streaming odgovoru

**Status:** ✅ (sa jednim **DOKUMENTACIJA vs STVARNOST** raskorakom — bitno)

- Ime polja potvrđeno: `delta.reasoning_content` (string ili `null`), potpuno
  odvojeno od `delta.content` — dolazi kao sopstveni niz delta chunk-ova, pre
  content chunk-ova u istom odgovoru.
- Non-stream ekvivalent: `message.reasoning_content`.
- **Dokumentacija tvrdi:**
  - bez `tools` u zahtevu → `reasoning_content` se NE mora vraćati; ako se
    vrati, API ga tiho ignoriše (ne ulazi u kontekst)
  - **sa `tools`** u zahtevu → prethodni `reasoning_content` MORA biti vraćen
    uz naredni poziv u istom tool-calling nizu, inače dokumentacija tvrdi da
    API vraća **400**
- **Live test je pokazao suprotno:** poslao sam drugi turn u tool-calling
  nizu BEZ `reasoning_content` (samo `content` + `tool_calls` u assistant
  poruci) i API je vratio **200**, normalan odgovor — nikakva 400 greška.
  Razlika koju sam primetio: kad se reasoning ne vrati, taj turn ima
  `reasoning_tokens: 0` (model ne razmišlja ponovo); kad se vrati, ima
  `reasoning_tokens: 17`. Samo jedan uzorak — nije statistički pouzdano,
  ali sugeriše da vraćanje reasoning-a možda utiče na kvalitet/trošak, ne na
  validnost zahteva.
- **Odluka za M1:** agent petlja svejedno **čuva i vraća** `reasoning_content`
  kad su `tools` u igri — prati dokumentovani ugovor, ne posmatrano
  permisivno ponašanje (koje se može promeniti bez najave). Kad `tools`
  nisu prisutni, ne mora se čuvati.

**Nalaz:** `StreamEvent.reasoning_delta` u `src/deepseek/types.ts` — trenutni
M0 skeleton (`cli.tsx`) prikazuje ali ne vraća u history jer ne radi
multi-turn; puna logika ide u M1.

**Izvor:** https://api-docs.deepseek.com/guides/thinking_mode/ (dokumentovano
ponašanje); live test — `probe.mjs`, pozivi `tool-call-turn2-WITHOUT-reasoning`
i `tool-call-turn2-WITH-reasoning` (stvarno ponašanje, 2026-08-27, oba status 200).
**Datum:** 2026-08-27

---

## 3. Struktura `usage` objekta

**Status:** ✅

Primer (non-stream poziv):
```json
"usage": {
  "prompt_tokens": 94,
  "completion_tokens": 39,
  "total_tokens": 133,
  "prompt_tokens_details": { "cached_tokens": 0 },
  "completion_tokens_details": { "reasoning_tokens": 37 },
  "prompt_cache_hit_tokens": 0,
  "prompt_cache_miss_tokens": 94
}
```

- Polja potvrđena tačno kako je pretpostavljeno u kodu:
  `prompt_tokens`, `completion_tokens`, `total_tokens`,
  `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`.
- **Bonus nalaz:** cache info dolazi u DVA oblika istovremeno — DeepSeek-specifično
  top-level `prompt_cache_hit_tokens`/`miss_tokens` I OpenAI-stil ugnježdeno
  `prompt_tokens_details.cached_tokens` (ista vrednost). Koristimo top-level
  jer je eksplicitniji.
- **Reasoning tokeni ULAZE u `completion_tokens`** (nisu odvojeni budžet) —
  vide se posebno samo informativno u `completion_tokens_details.reasoning_tokens`.
  **Bitno za `max_tokens` budžetiranje:** thinking mode troši od istog
  `max_tokens` budžeta kao i finalni odgovor.
- **Streaming:** `usage` stiže **isključivo u poslednjem chunk-u**, i **samo**
  ako je zahtev poslao `"stream_options": {"include_usage": true}`. Bez tog
  parametra `usage` je `null` u SVAKOM chunk-u, uključujući poslednji.
  **Ovo je bio pravi bag u M0 scaffoldu** — `client.ts` originalno nije slao
  `stream_options`, ispravljeno 2026-08-27.

**Nalaz:** `UsageInfo` u `src/deepseek/types.ts` ažuriran — polja su sad
non-optional (uvek stižu, default 0), dodato `reasoningTokens`.

**Izvor:** https://api-docs.deepseek.com/api/create-chat-completion/;
live testovi — `probe.mjs` (non-stream) i `probe-stream.mjs` (stream, poslednji chunk).
**Datum:** 2026-08-27

---

## 4. Tool calling u thinking modu

**Status:** ✅

- Redosled u streamu: **reasoning_content delte prve, pa tool_calls delte**,
  `finish_reason: "tool_calls"` na kraju sa `usage`. Reasoning uvek kompletan
  pre nego što tool-call počne da se emituje.
- `tool_calls` streaming oblik — standardan OpenAI-kompatibilan fragment:
  - prvi chunk po pozivu: `{"index":0,"id":"call_...","type":"function","function":{"name":"get_time","arguments":""}}`
  - naredni chunk-ovi: samo `{"index":0,"function":{"arguments":"<fragment>"}}`
    — argumenti stižu karakter-po-karakter/fragment-po-fragment, spajaju se
    na klijentu po `index` sve dok se ne dobije validan JSON.
- Non-stream: `message.tool_calls` je već kompletan niz, `message.reasoning_content`
  puna string vrednost — nema potrebe za spajanjem.
- Nisam testirao paralelne tool pozive (`tool_choice` sa više funkcija u
  jednom odgovoru) — dodato u otvorena pitanja na dnu.

**Nalaz:** `StreamEvent.tool_call_delta` nosi sirov `raw` (akumulacija po
`index` ostavljena za M1 agent petlju — nije implementirana u M0 skeletonu).

**Izvor:** live test — `probe-stream.mjs`, poziv sa `get_time` alatom,
`deepseek-v4-flash`, `reasoning_effort: "low"`.
**Datum:** 2026-08-27

---

## 5. Responses API vs Chat Completions

**Status:** 🔶 (iz dokumentacije; nismo probali live poziv na Responses API)

- Responses API nudi `function_call`/`function_call_output` **items** koji se
  "spajaju u susednu assistant poruku" — drugačiji mentalni model od
  chat-completions message array-a, bliži server-side agent state-u.
  Eksplicitni `reasoning` item + streaming eventi
  `response.reasoning_text.delta` / `.done` (semantički eventi po tipu
  outputa — reasoning/message/function_call/custom_tool_call/web_search_call
  start/complete), umesto ravnih delta chunk-ova kao u chat completions.
- **Caching razlika (bitno za M3):** Responses API **ne podržava**
  `prompt_cache_key`/`prompt_cache_retention` — keširanje je potpuno
  automatsko, kontrolišeš ga samo strukturom prompta, a rezultat vidiš kroz
  `cached_tokens` u usage-u. Chat Completions daje eksplicitne
  `prompt_cache_hit_tokens`/`miss_tokens` (tačka 3) — više vidljivosti/kontrole.
- **Preporuka za M1/M3:** ostati na **Chat Completions**. M3-ov zahtev za
  merljivom cache-aware arhitekturom (spec, README metrika) traži preciznu
  vidljivost u cache hit/miss po pozivu — to Chat Completions daje direktno,
  Responses API to apstrahuje. Responses API vredi revizitovati ako se M1
  agent petlja pokaže bolje modelovana kroz njegove item/state primitive.

**Nalaz:** odluka — M1 se gradi na `/chat/completions`, ne na Responses API.

**Izvor:** https://api-docs.deepseek.com/guides/responses_api/,
https://api-docs.deepseek.com/api/create-response/ (dokumentacija; nije
verifikovano live pozivom).
**Datum:** 2026-08-27

---

## 6. Cache ponašanje u praksi

**Status:** 🔶 (osnovno potvrđeno, TTL i osetljivost na izmene nisu testirani)

- Test: dva uzastopna poziva (razmak ~1s) sa identičnim dugim `system` prefiksom
  (~1300 tokena) i različitim poslednjim `user` porukama.
  - Poziv 1: `prompt_cache_hit_tokens: 0`, `miss: 1305` (hladan cache, očekivano)
  - Poziv 2: `prompt_cache_hit_tokens: 1280`, `miss: 28` — **skoro ceo stabilni
    prefiks je pogodio cache** posle samo ~1s.
- Cache hit je merljiv direktno iz `usage.prompt_cache_hit_tokens` po pozivu —
  potvrđuje da je M3-ov "merljivo, ide u README" zahtev izvodljiv bez ikakvog
  posrednog računanja.
- **Nije testirano (ostaje za M1/M3, uz realne agent pozive):**
  - TTL — koliko ostaje topao bez saobraćaja
  - Da li izmena bilo čega PRE stabilnog prefiksa (npr. redosled poruka)
    ruši ceo cache ili samo taj deo
  - Da li se cena zaista obračunava po `$0.007/$0.022` za cache-hit deo —
    ovo se vidi tek na fakturi/dashboard-u, ne u `usage` odgovoru (usage daje
    samo brojeve tokena, ne cenu)

**Nalaz:** cache radi kako plan pretpostavlja; keširanje agresivno i brzo.

**Izvor:** live test — `probe.mjs`, pozivi `cache-call-1` / `cache-call-2`.
**Datum:** 2026-08-27

---

## 7. Peak/off-peak

**Status:** 🔶

- Svi live testovi rađeni ~12:05 UTC (off-peak prozor) — nijedan odgovor
  (ni `usage`, ni header-i koje smo pregledali) **ne sadrži bilo kakav
  peak/off-peak indikator**. Ni u changelog-u (api-docs.deepseek.com/updates/)
  nije pomenuto polje za to.
- **Zaključak: mora se računati lokalno po UTC satu**, tačno kako plan
  pretpostavlja (01:00–04:00 i 06:00–10:00 UTC = peak).
- Nije testirano: da li se obračun radi po trenutku slanja zahteva ili
  generisanja odgovora — bitno za dugačke thinking-mode pozive koji mogu
  preći granicu sata. Ne postoji način da se ovo utvrdi bez poziva tačno na
  granici i poređenja sa fakturom — ostaje otvoreno, niskog je prioriteta za
  M0 (M3 implementira `/usage` procenu, tada se preciznije reši).

**Nalaz:** peak/off-peak se računa lokalno (`Date` u UTC), API ne pomaže.

**Izvor:** live testovi (odsustvo polja), https://api-docs.deepseek.com/updates/.
**Datum:** 2026-08-27

---

## 8. Vision (dodato u M3)

**Status:** ✅

- Samo `deepseek-v4-flash-vision-exp` podržava slike — ostali modeli vraćaju
  grešku ako se pošalje `image_url`.
- Slike su dozvoljene **isključivo u `user` porukama** — `system`/`assistant`
  sa slikom vraćaju 400.
- Format: standardan OpenAI `content` niz —
  `[{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}]`.
  Podržani formati: JPEG/PNG/GIF/WebP. Base64/URL slika do 32 MiB, ceo request
  do 48 MiB, do 600 slika po pozivu. Slika se skalira na ~800×800, ~384 tokena.
- Tool-calling i thinking mode u kombinaciji sa vision nisu dokumentovani —
  zato `view_image` alat (`src/agent/tools/viewImage.ts`) radi **izolovan**
  non-streaming poziv (`thinking: disabled`, bez `tools`) i vraća čist tekst
  nazad glavnom agentu kao rezultat alata. Glavna petlja nikad ne šalje
  `tools`/`thinking` zajedno sa slikom.
- Live test uživo (real screenshot, kroz punu tool-calling petlju sa
  `deepseek-v4-flash`): model je sam prepoznao potrebu da pozove
  `view_image`, dobio tačan opis nazad i odgovorio korisniku ispravno.

**Izvor:** https://api-docs.deepseek.com/guides/vision; live test —
`view_image` alat, `deepseek-v4-flash-vision-exp`.
**Datum:** 2026-08-27

## 9. KV cache — detaljna mehanika (za M3 cache-aware arhitekturu)

**Status:** ✅ (dokumentacija; brojevi iz M0 #6 ostaju živi test)

- Cache pogađa samo pri **potpunom poklapanju prefiksa** — "cache prefix
  unit" mora biti identičan bajt-za-bajt, ne samo delimično sličan.
  Potvrđuje pristup iz plana: stabilan prefiks (system + tools + repo mapa +
  plan) mora biti IDENTIČAN kroz sve worker pozive u istoj orkestraciji,
  varijabilni deo (task) ide na kraj.
- Cache jedinice nastaju na tri mesta: (1) kraj user inputa i kraj model
  outputa svakog poziva, (2) zajednički prefiks kad više zahteva deli
  početni sadržaj, (3) fiksni intervali kod dugih inputa/outputa.
- TTL: sati do par dana, automatsko brisanje — dovoljno da ostane toplo
  kroz celu jednu orkestraciju (planner → workeri → reviewer) pa i između
  odvojenih pokretanja istog dana.
- Nema eksplicitnog cache-key parametra — keširanje je potpuno automatsko na
  osnovu sadržaja `messages` (i verovatno `tools`, mada to dokumentacija ne
  precizira eksplicitno — zato worker petlja šalje identičan `tools` niz na
  svaki poziv, ne samo identičan `messages` prefiks).
- **Live potvrda u orkestraciji:** dva uzastopna worker poziva sa istim
  stabilnim prefiksom (plan+repo mapa) pokazala su rastući cache hit
  (4608 → 7168 cached tokena) tačno kako mehanika predviđa.

**Izvor:** https://api-docs.deepseek.com/guides/kv_cache; live test —
`orchestrate.ts`, dva worker poziva u istoj orkestraciji.
**Datum:** 2026-08-27

## 10. Web search preko Responses API-ja

**Status:** ✅

- Web search je dokumentovan **isključivo** u Responses API-ju (`POST /responses`),
  ne u Chat Completions — potvrđeno i u dokumentaciji i u testu (chat completions
  ne prihvata `web_search` tool tip).
- Poziv je **stateless** i radi izolovano, bez potrebe za state managementom —
  isti obrazac kao `view_image`: poseban, jednokratan poziv čiji tekstualni
  rezultat ulazi nazad u glavnu tool-calling petlju kao string.
- Zahtev: `{"model": "...", "input": "upit", "tools": [{"type":"web_search"}],
  "tool_choice": {"type":"web_search"}}`. Odgovor: `output` niz sa
  `web_search_call` stavkama (šta je pretraženo) i `message` stavkom
  (`content[0].text` je finalni tekst).
- Usage polja su drugačija od Chat Completions: `input_tokens`/`output_tokens`/
  `total_tokens` umesto `prompt_tokens`/`completion_tokens`, i `cached_tokens`
  umesto `prompt_cache_hit_tokens`/`miss_tokens` — mapirano u naš `UsageInfo`
  oblik u `src/deepseek/webSearch.ts`.
- Nema objavljen zaseban cenovnik za Responses API pozive — trošak se u
  `web_search`/`view_image` alatima prijavljuje po Flash tarifi kao
  najbolja dostupna procena (stvarni tokeni ostaju tačni iz API-ja).

**Izvor:** https://api-docs.deepseek.com/guides/responses_api,
https://api-docs.deepseek.com/api/create-response/.
**Datum:** 2026-08-27

## Otvorena pitanja van originalne liste

- Paralelni tool pozivi (više `tool_calls` u jednom odgovoru) — nije testirano.
- Anthropic-kompatibilan format (`/v1/messages`-stil endpoint, `reasoning.effort`
  sintaksa) — nismo ga uopšte probali, sve gore je OpenAI-kompatibilan format.
- Da li resenje reasoning_content-a u tool-calling nizu (tačka 2) menja kvalitet
  ili trošak na većem uzorku — n=1 test nije dovoljan, treba par desetina poziva.
- TTL cache-a i osetljivost na izmenu prefiksa (tačka 6).
- Ponašanje 400/greške za nevalidne kombinacije parametara (npr. `thinking`
  enabled + model koji ga ne podržava — nismo probali sa modelom bez thinking
  podrške jer oba V4 modela ga podržavaju).
- `deepseek-v4-flash-vision-exp` — nije uopšte testiran, van scope-a M0/M1.
