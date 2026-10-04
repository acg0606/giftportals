# V10 cloud moderation

The existing Vercel project serves `POST /api/cloud-vision` as a Python function.
The Node generation worker sends short-lived, private Supabase signed URLs,
declared byte lengths, MIME types and SHA-256 hashes. Images are fetched only
from the exact configured Supabase project and private signed-object route.
Redirects, public URLs, credentials in URLs, foreign origins, oversized bodies,
incorrect hashes, unknown classifier output and concurrent inference fail closed.

Set these server environment variables in the same production deployment:

- `SUPABASE_URL=https://<project-ref>.supabase.co`
- `GIFTPORTALS_CLOUD_MODERATION_URL=https://<production-domain>/api/cloud-vision`
- `GIFTPORTALS_CLOUD_MODERATION_KEY`: a random secret of at least32 characters.

The browser never receives the moderation secret. The Python handler does not
use provider keys. The existing `CRON_SECRET` still protects global job ticks.
Keep `ENABLE_CLOUD_GENERATION` false until migrations, private buckets, budgets,
provider credentials, the moderator and a real production smoke check are ready.

The build prepares the nine pinned model files before compilation. It downloads
only fixed Hugging Face revisions and checks every declared size and SHA-256.
Inference never downloads models. Local build preparation can reuse installed
weights by setting `GIFTPORTALS_VISION_SOURCE_DIR` to their directory.

`api/_vision_models` is excluded from Git and deploy-upload input. Vercel's build
recreates it, and only the Python function includes those179MB of model bytes.
The Python function excludes frontend assets and uses pinned Python3.12,
ONNX Runtime1.20.1, tokenizers0.22.2, NumPy2.2.6 and Pillow11.2.1.
The policy bank and thresholds are generated from the same policy-3 module used
by the local checker; the cloud client requires this exact named model version.

Derived Tripo references are first placed in a private moderation quarantine.
Their URL expires after120 seconds. They become gift assets only after a valid
allow proof. Retention removes input, moderation and generated prefixes before
releasing a gift's storage reservation.

Verification completed locally:29 cloud/HTTP tests,8 moderator/retention tests,
four Python protocol/policy tests and strict cloud TypeScript. The production
Python HTTP handler also ran real ONNX inference against the studio reference
through an offline test storage transport: HTTP200, allow, policy-3 and exact
SHA-256, with zero provider calls. Deployment remains a separate verification.

Official limits and runtime support:

- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/runtimes/python/api-directory
- https://supabase.com/docs/guides/functions/limits
