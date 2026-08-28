# DeepSeek API — Notes (M0)

[Srpski (canonical version)](./api-notes.md) | **English**

**Source of truth** for every phase after this one (see the [development
plan](../deepseek-cli-development-plan.md), Serbian only). Every finding
here must be verified against the **live API** or **official docs** —
nothing gets taken from blog posts or other projects' code without our own
verification.

Status values: `☐ not verified` · `🔶 partial / unclear` · `✅ verified`

---

## 1. Thinking mode and reasoning effort parameters

**Status:** ✅

- **OpenAI-compatible format** (what we use, `/chat/completions`):
  ```json
  { "thinking": { "type": "enabled", "reasoning_effort": "low" } }
  ```
  To disable: `{"thinking": {"type": "disabled"}}`.
- **Anthropic-compatible format** (a different endpoint, not tested by us):
  `{"reasoning": {"effort": "none/low/high/max"}}`.
- Allowed values for `reasoning_effort`: **`low` / `high` / `max`**
  (NOT `medium` — our initial assumption in the code was wrong). `medium`
  and `xhigh` are still accepted for compatibility, but get mapped to `high`
  internally.
  Default (if `thinking` is omitted): enabled, effort high.
- In thinking mode, `temperature`/`top_p`/`presence_penalty`/`frequency_penalty`
  are silently ignored (no error thrown).
- On calls with `tools`, reasoning_content shows up **together** with
  `tool_calls` in the same message — confirmed by a live test.

**Finding:** implemented in `src/deepseek/client.ts` and `src/deepseek/types.ts`
(`ThinkingConfig.reasoningEffort: "low" | "high" | "max"`).

**Source:** https://api-docs.deepseek.com/guides/thinking_mode/,
https://api-docs.deepseek.com/api/create-chat-completion/, live call
(non-stream, `deepseek-v4-flash`, `reasoning_effort: "low"`, 12*7 example).
**Date:** 2026-08-27

---

## 2. `reasoning_content` in streaming responses

**Status:** ✅ (with one **DOCUMENTATION vs REALITY** gap — important)

- Field name confirmed: `delta.reasoning_content` (string or `null`),
  completely separate from `delta.content` — arrives as its own run of delta
  chunks, before the content chunks in the same response.
- Non-stream equivalent: `message.reasoning_content`.
- **The docs claim:**
  - without `tools` in the request → `reasoning_content` does NOT need to be
    sent back; if it is, the API silently ignores it (doesn't enter context)
  - **with `tools`** in the request → the previous `reasoning_content` MUST
    be sent back on the next call in the same tool-calling sequence,
    otherwise the docs claim the API returns **400**
- **A live test showed the opposite:** I sent a second turn in a
  tool-calling sequence WITHOUT `reasoning_content` (just `content` +
  `tool_calls` in the assistant message) and the API returned **200**, a
  normal response — no 400 error at all. The difference I noticed: when
  reasoning isn't sent back, that turn has `reasoning_tokens: 0` (the model
  doesn't re-think); when it is sent back, it has `reasoning_tokens: 17`.
  Only one sample — not statistically reliable, but it suggests sending
  reasoning back may affect quality/cost, not request validity.
- **Decision for M1:** the agent loop **stores and sends back**
  `reasoning_content` regardless, whenever `tools` are in play — follow the
  documented contract, not the observed permissive behavior (which could
  change without notice). When `tools` aren't present, it doesn't need to be
  kept.

**Finding:** `StreamEvent.reasoning_delta` in `src/deepseek/types.ts` — the
original M0 skeleton (`cli.tsx`) displayed but didn't send it back in
history since it didn't do multi-turn; the full logic landed in M1.

**Source:** https://api-docs.deepseek.com/guides/thinking_mode/ (documented
behavior); live test — `probe.mjs`, calls `tool-call-turn2-WITHOUT-reasoning`
and `tool-call-turn2-WITH-reasoning` (actual behavior, 2026-08-27, both
status 200).
**Date:** 2026-08-27

---

## 3. `usage` object structure

**Status:** ✅

Example (non-stream call):
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

- Fields confirmed exactly as assumed in the code:
  `prompt_tokens`, `completion_tokens`, `total_tokens`,
  `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`.
- **Bonus finding:** cache info arrives in TWO forms at once — the
  DeepSeek-specific top-level `prompt_cache_hit_tokens`/`miss_tokens` AND the
  OpenAI-style nested `prompt_tokens_details.cached_tokens` (same value). We
  use the top-level ones since they're more explicit.
- **Reasoning tokens ARE INCLUDED in `completion_tokens`** (not a separate
  budget) — they're only broken out informationally in
  `completion_tokens_details.reasoning_tokens`. **Important for `max_tokens`
  budgeting:** thinking mode draws from the same `max_tokens` budget as the
  final answer.
- **Streaming:** `usage` arrives **only in the final chunk**, and **only**
  if the request sent `"stream_options": {"include_usage": true}`. Without
  that parameter `usage` is `null` in EVERY chunk, including the last one.
  **This was a real bug in the M0 scaffold** — `client.ts` originally didn't
  send `stream_options`, fixed on 2026-08-27.

**Finding:** `UsageInfo` in `src/deepseek/types.ts` updated — fields are now
non-optional (always arrive, default 0), added `reasoningTokens`.

**Source:** https://api-docs.deepseek.com/api/create-chat-completion/; live
tests — `probe.mjs` (non-stream) and `probe-stream.mjs` (stream, last chunk).
**Date:** 2026-08-27

---

## 4. Tool calling in thinking mode

**Status:** ✅

- Stream order: **reasoning_content deltas first, then tool_calls deltas**,
  `finish_reason: "tool_calls"` at the end with `usage`. Reasoning is always
  complete before a tool call starts being emitted.
- `tool_calls` streaming shape — standard OpenAI-compatible fragment:
  - first chunk per call: `{"index":0,"id":"call_...","type":"function","function":{"name":"get_time","arguments":""}}`
  - subsequent chunks: just `{"index":0,"function":{"arguments":"<fragment>"}}`
    — arguments arrive character-by-character/fragment-by-fragment, merged
    client-side by `index` until a valid JSON is obtained.
- Non-stream: `message.tool_calls` is already a complete array,
  `message.reasoning_content` a full string value — no merging needed.
- Didn't test parallel tool calls (`tool_choice` with multiple functions in
  one response) — added to open questions at the bottom.

**Finding:** `StreamEvent.tool_call_delta` carries raw `raw` (accumulation by
`index` left for the M1 agent loop — not implemented in the M0 skeleton).

**Source:** live test — `probe-stream.mjs`, call with the `get_time` tool,
`deepseek-v4-flash`, `reasoning_effort: "low"`.
**Date:** 2026-08-27

---

## 5. Responses API vs Chat Completions

**Status:** 🔶 (from documentation; we haven't tried a live call against the
Responses API)

- The Responses API offers `function_call`/`function_call_output` **items**
  that "merge into the adjacent assistant message" — a different mental
  model from the chat-completions message array, closer to server-side
  agent state. An explicit `reasoning` item + streaming events
  `response.reasoning_text.delta` / `.done` (semantic events by output type
  — reasoning/message/function_call/custom_tool_call/web_search_call
  start/complete), instead of flat delta chunks like in chat completions.
- **Caching difference (important for M3):** the Responses API **does not
  support** `prompt_cache_key`/`prompt_cache_retention` — caching is fully
  automatic, you only control it via prompt structure, and you see the
  result through `cached_tokens` in usage. Chat Completions gives explicit
  `prompt_cache_hit_tokens`/`miss_tokens` (point 3) — more visibility and
  control.
- **Recommendation for M1/M3:** stay on **Chat Completions**. M3's
  requirement for a measurable cache-aware architecture (spec, README
  metric) needs precise per-call cache hit/miss visibility — Chat
  Completions gives that directly, the Responses API abstracts it away.
  Worth revisiting the Responses API if the M1 agent loop turns out to be
  better modeled through its item/state primitives.

**Finding:** decision — M1 is built on `/chat/completions`, not the
Responses API.

**Source:** https://api-docs.deepseek.com/guides/responses_api/,
https://api-docs.deepseek.com/api/create-response/ (documentation; not
verified with a live call).
**Date:** 2026-08-27

---

## 6. Cache behavior in practice

**Status:** 🔶 (basics confirmed, TTL and sensitivity to edits not tested)

- Test: two consecutive calls (~1s apart) with an identical long `system`
  prefix (~1300 tokens) and different final `user` messages.
  - Call 1: `prompt_cache_hit_tokens: 0`, `miss: 1305` (cold cache, expected)
  - Call 2: `prompt_cache_hit_tokens: 1280`, `miss: 28` — **almost the whole
    stable prefix hit the cache** after only ~1s.
- Cache hit is directly measurable from `usage.prompt_cache_hit_tokens` per
  call — confirms M3's "measurable, goes into the README" requirement is
  achievable with no indirect calculation.
- **Not tested (left for M1/M3, with real agent calls):**
  - TTL — how long it stays warm with no traffic
  - Whether changing anything BEFORE the stable prefix (e.g. message order)
    breaks the whole cache or just that part
  - Whether the price is actually billed at `$0.007/$0.022` for the
    cache-hit portion — this only shows up on the invoice/dashboard, not in
    the `usage` response (usage only gives token counts, not price)

**Finding:** cache works as the plan assumes; caching is aggressive and fast.

**Source:** live test — `probe.mjs`, calls `cache-call-1` / `cache-call-2`.
**Date:** 2026-08-27

---

## 7. Peak/off-peak

**Status:** 🔶

- All live tests were run at ~12:05 UTC (off-peak window) — no response
  (neither `usage` nor the headers we checked) **contains any peak/off-peak
  indicator**. The changelog (api-docs.deepseek.com/updates/) doesn't
  mention a field for this either.
- **Conclusion: it has to be computed locally by UTC hour**, exactly as the
  plan assumes (01:00–04:00 and 06:00–10:00 UTC = peak).
- Not tested: whether the billing is based on the moment the request was
  sent or the moment the response was generated — matters for long
  thinking-mode calls that might cross the hour boundary. There's no way to
  determine this without a call placed exactly on the boundary and comparing
  it to the invoice — left open, low priority for M0 (M3 implements the
  `/usage` estimate, where this gets resolved more precisely).

**Finding:** peak/off-peak is computed locally (`Date` in UTC), the API
doesn't help.

**Source:** live tests (absence of the field), https://api-docs.deepseek.com/updates/.
**Date:** 2026-08-27

---

## 8. Vision (added in M3)

**Status:** ✅

- Only `deepseek-v4-flash-vision-exp` supports images — other models return
  an error if `image_url` is sent.
- Images are allowed **exclusively in `user` messages** — `system`/`assistant`
  with an image return 400.
- Format: standard OpenAI `content` array —
  `[{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}]`.
  Supported formats: JPEG/PNG/GIF/WebP. Base64/URL image up to 32 MiB, whole
  request up to 48 MiB, up to 600 images per call. Image gets scaled to
  ~800×800, ~384 tokens.
- Tool-calling and thinking mode combined with vision aren't documented —
  that's why the `view_image` tool (`src/agent/tools/viewImage.ts`) makes an
  **isolated** non-streaming call (`thinking: disabled`, no `tools`) and
  returns plain text back to the main agent as the tool result. The main
  loop never sends `tools`/`thinking` together with an image.
- Live test (real screenshot, through the full tool-calling loop with
  `deepseek-v4-flash`): the model figured out on its own that it needed to
  call `view_image`, got the correct description back, and answered the
  user correctly.

**Source:** https://api-docs.deepseek.com/guides/vision; live test —
`view_image` tool, `deepseek-v4-flash-vision-exp`.
**Date:** 2026-08-27

## 9. KV cache — detailed mechanics (for the M3 cache-aware architecture)

**Status:** ✅ (documentation; the numbers from M0 #6 remain the live test)

- Cache only hits on a **full prefix match** — a "cache prefix unit" must be
  byte-for-byte identical, not just partially similar. Confirms the plan's
  approach: the stable prefix (system + tools + repo map + plan) must be
  IDENTICAL across all worker calls in the same orchestration, with the
  variable part (the task) going at the end.
- Cache units form in three places: (1) end of user input and end of model
  output on every call, (2) a shared prefix when multiple requests share
  leading content, (3) fixed intervals for long inputs/outputs.
- TTL: hours to a couple of days, automatic eviction — enough to stay warm
  through one whole orchestration (planner → workers → reviewer), and even
  between separate runs on the same day.
- No explicit cache-key parameter — caching is fully automatic based on the
  content of `messages` (and probably `tools`, though the docs don't specify
  that explicitly — that's why the worker loop sends an identical `tools`
  array on every call, not just an identical `messages` prefix).
- **Live confirmation during orchestration:** two consecutive worker calls
  with the same stable prefix (plan+repo map) showed a growing cache hit
  (4608 → 7168 cached tokens), exactly as the mechanics predict.

**Source:** https://api-docs.deepseek.com/guides/kv_cache; live test —
`orchestrate.ts`, two worker calls in the same orchestration.
**Date:** 2026-08-27

## 10. Web search via the Responses API

**Status:** ✅

- Web search is documented **exclusively** in the Responses API
  (`POST /responses`), not in Chat Completions — confirmed both in the docs
  and in testing (Chat Completions doesn't accept the `web_search` tool
  type).
- The call is **stateless** and works in isolation, no state management
  needed — the same pattern as `view_image`: a separate, one-off call whose
  text result flows back into the main tool-calling loop as a string.
- Request: `{"model": "...", "input": "query", "tools": [{"type":"web_search"}],
  "tool_choice": {"type":"web_search"}}`. Response: an `output` array with
  `web_search_call` items (what was searched) and a `message` item
  (`content[0].text` is the final text).
- Usage fields differ from Chat Completions: `input_tokens`/`output_tokens`/
  `total_tokens` instead of `prompt_tokens`/`completion_tokens`, and
  `cached_tokens` instead of `prompt_cache_hit_tokens`/`miss_tokens` — mapped
  into our `UsageInfo` shape in `src/deepseek/webSearch.ts`.
- No separate published pricing for Responses API calls — cost is reported
  by the `web_search`/`view_image` tools at the Flash rate as the best
  available estimate (the actual token counts remain accurate, straight
  from the API).

**Source:** https://api-docs.deepseek.com/guides/responses_api,
https://api-docs.deepseek.com/api/create-response/.
**Date:** 2026-08-27

## Open questions beyond the original list

- Parallel tool calls (multiple `tool_calls` in one response) — not tested.
- Anthropic-compatible format (`/v1/messages`-style endpoint,
  `reasoning.effort` syntax) — we haven't tried it at all, everything above
  is the OpenAI-compatible format.
- Whether sending reasoning_content back in a tool-calling sequence (point
  2) changes quality or cost at a larger sample size — n=1 isn't enough,
  needs a few dozen calls.
- Cache TTL and sensitivity to prefix changes (point 6).
- 400/error behavior for invalid parameter combinations (e.g. `thinking`
  enabled + a model that doesn't support it — we haven't tried it with a
  model lacking thinking support since both V4 models support it).
- `deepseek-v4-flash-vision-exp` — not tested at all otherwise, out of scope
  for M0/M1.
