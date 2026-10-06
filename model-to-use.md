The model you're using now (FLUX.2-klein-4B on Cloudflare) is the **lowest quality** of these options. It works from a downscaled photo under 512 px with only 4 steps. Almost every paid option below is more accurate, and most cost a few US cents per image. Prices are as published in mid-2026; check them before committing.

## Free options

| Model / where | Limit | Quality vs. now | In the app? |
|---|---|---|---|
| **FLUX.2-klein-4B, Cloudflare Workers AI** (current) | ~90 previews/day; slow or unresponsive when busy | baseline | ✅ `cloudflare` |
| **Qwen-Image-Edit-2511, Hugging Face Space** | a few images/day per account (free GPU allowance) | better: kept faces well in our tests | ✅ `huggingface` |
| Gemini free tier (Google AI Studio) | **0 image requests** on the free tier | — | ✅ but unusable free |

Free options are fine for demos, but none is dependable for a working salon: daily caps, slowdowns at busy times, and no guarantees.

## Paid options (better accuracy, predictable)

| Model | Approx. price per image | Per customer (4 previews) | Notes | In the app? |
|---|---|---|---|---|
| **Gemini 2.5 Flash Image ("Nano Banana")** | **$0.04** ($0.02 via batch) | ~$0.16 | **Recommended.** Best at keeping the same face, closest to your example sheet | ✅ `gemini` (Google key with billing) or `openrouter` |
| FLUX.2-klein (on fal.ai / BFL API) | ~$0.014–0.02 | ~$0.06–0.08 | Same model as now, but full resolution and no daily cap | ❌ needs a small provider class |
| Qwen-Image-Edit-2511 (fal.ai) | ~$0.03 | ~$0.12 | Strong at keeping identity; Apache-2.0 licence | ❌ needs a small provider class |
| FLUX.1 Kontext [pro] (BFL API) | $0.04 | ~$0.16 | Good instruction-based editing | ❌ needs a small provider class |
| FLUX.2 [pro] edit (BFL API) | from $0.045/megapixel | ~$0.18+ | High quality | ❌ |
| **Gemini 3 Pro Image** | ~$0.134 (1–2K) | — | Use only for the **one final reference** of the chosen style | ✅ already the "HQ" model for `gemini`/`openrouter` |
| Cloudflare paid plan ($5/month) | ~$0.001 beyond the free allowance | negligible | Same model as now, without the daily cap, but just as slow when busy | ✅ no change |

## What I'd do

1. **Production:** Gemini 2.5 Flash Image for the 4 previews. That's about **$0.16 per customer**, so roughly $16 per 100 customers. Optionally add Gemini 3 Pro Image for the single chosen look (+$0.13). It's already built in: either enable billing on your Google key (`IMAGE_EDIT_PROVIDER=gemini`), or add OpenRouter credits (`IMAGE_EDIT_PROVIDER=openrouter`).
2. **Cheapest paid option:** Qwen-Image-Edit-2511 or FLUX.2-klein on fal.ai, at about $0.06–0.12 per customer. I'd need to add a fal.ai provider; it's small, because the app already has provider classes.
3. **Free demos only:** keep Cloudflare as the main provider, with `IMAGE_EDIT_FALLBACK_PROVIDER=huggingface` as a backup.

Whichever you choose, the same checks run on every preview: the customer is still the same person, nothing is added to the face, hair colour is kept, and the background is unchanged. A stronger model mainly means fewer rejected previews and sharper hair detail.

Sources:
- [Gemini 2.5 Flash Image pricing](https://anotherwrapper.com/tools/llm-pricing/image-models/gemini-25-flash-image-nano-banana)
- [Gemini 3 Pro Image pricing](https://blog.laozhang.ai/en/posts/gemini-3-pro-image-api-pricing)
- [Qwen Image Edit 2511 on fal.ai (pricing)](https://pricepertoken.com/image/model/qwen-qwen-image-edit-2511)
- [FLUX.2 pricing guide (BFL)](https://help.bfl.ai/articles/7686530342-flux-2-pricing-guide)
- [FLUX API pricing breakdown (Jun 2026)](https://developer.puter.com/tutorials/flux-api-pricing/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)