# 0045 The model bake-off (spike S3)

Status: accepted. Qwen 3.8 27B through Ollama (Stephen, 9 November 2026).
Date: 2026-11-09

## Question
Qwen 3.8 27B or Gemma 4 26B-A4B as the default model on the RTX 4090, through llama-server or LM Studio's llmster? Which prompt and schema shapes work?

## How it was run
- **Models.** Both models at Q4_K_M from LM Studio's community builds. Each runtime loaded the same file, with an 8,192-token context, temperature 0 and thinking off.
- **Runs.** One run per model and runtime, one at a time on the GPU. The harness is now `tools/eval/`, with prompts in `prompts/` and scoring in `score.ts`, and `pnpm eval` runs it. The replies quote the family's data, so they're in `private/s3-results/`.
- **Task 1, suggest a job.** 229 transactions the family labelled with jobs. Rows labelled Unsure or Split are left out. The models got them in batches of 20, and also one at a time. "Seen once" counts the 71 rows whose payee appears only once in the labels. Those are the ones Holt sends to the model, because rules and "same as last time" can't place them.
- **Task 2, Ask.** The 24 questions in `private/questions.json`. A reply is correct when core gives the same figures and transactions as the hand-written reply (decision 0044). Questions 13 and 23 can fairly be read two ways, so they record both readings.
- **Task 3, the monthly review.** August to October, from the figures in `private/reviews/`. A draft has to name every figure by placeholder and contain no digits outside them, with one retry allowed. Stephen's drafts are the reference for content, not for tone.

## Results
| | Qwen, llama-server | Qwen, llmster | Gemma, llama-server | Gemma, llmster |
|---|---|---|---|---|
| Job, batches of 20 | 67.7% | 67.2% | 70.7% | 67.7% |
| Job, payees seen once | 47.9% | 45.1% | 46.5% | 46.5% |
| Job, one at a time | 54.6% | 54.1% | 68.6% | 68.6% |
| Ask correct (of 24) | 87.5% (21) | 83.3% (20) | 79.2% (19) | 70.8% (17) |
| Valid JSON | 100% | 100% | 100% | 100% |
| Review drafts passing first time | 3 of 3 | 3 of 3 | 2 of 3 | 1 of 3 |
| Median Ask reply | 2.3 s | 2.3 s | 1.2 s | 1.6 s |
| Median batch of 20 | 6.0 s | 5.5 s | 3.3 s | 3.8 s |
| GPU memory, model loaded | 20.5 GB | 24.0 GB | 21.5 GB | 23.6 GB |

Every figure comes from a single run. One Ask question is 4.2 points, and a job score on 229 rows is uncertain by several points. Differences of one or two questions, or two or three points, are noise.

## Findings
- **Qwen is the better choice for Ask and the review.** It answered more questions correctly on both runtimes. Its drafts read well and kept to the placeholder rule first time, every time. Gemma's drafts passed only after a retry, and they misuse placeholders: one began "The month of", followed by the month's income figure, and another listed new payees by their amounts instead of their names.
- **Suggesting a job is a tie where it matters.** For payees seen once, the rows Holt actually sends to the model, every configuration got 45–48% right. Gemma does better one transaction at a time, but Holt sends an import as a batch. Under half right means a suggestion must stay a proposal the family confirms (rule 8). Rules and "same as last time" do most of the work. Many mistakes are ambiguous even for a person: a Vipps payment to someone, or "Fun and personal" against another job.
- **Gemma is about twice as fast.** It activates only part of itself per token. Qwen's 2.3 seconds per Ask reply is still fine for a palette, and an import's batch of 20 takes about 6 seconds.
- **Multi-token prediction doubles Qwen's speed.** Qwen's file has a multi-token prediction layer. llmster uses it by default; llama-server needs `--spec-type draft-mtp`. Without it, Qwen generated about 40 tokens a second on llama-server against about 90 on llmster, and with it about 83. With greedy decoding it doesn't change the answers: Ask came out identical.
- **The runtimes switch thinking off differently.** Both models think by default, which slows structured replies down and can cut them off. llama-server takes `chat_template_kwargs: {"enable_thinking": false}` per request. llmster ignores that and takes `reasoning_effort: "none"`. Holt's adapter needs one setting for each (§6).
- **llmster uses 2–3.5 GB more GPU memory** for the same file and context. With Qwen that leaves under 1 GB free next to the desktop.
- **Every reply was valid JSON**, because constrained decoding works on both runtimes with the OpenAI-style `json_schema` wrapper.

## Ollama, and one copy of the model
Stephen's own scripts already use Ollama's copy of Qwen 3.8 27B, so the bake-off ran twice more:
- **llama-server with Ollama's file.** The file is the same model and quantisation, but a different conversion: it has the same 866 tensors, 65 layers and multi-token prediction layer. It scored the same as the tested file: 69.0% of jobs in batches, 47.9% for payees seen once, 21 of 24 Ask questions and 3 of 3 reviews, with a median Ask reply of 1.6 s.
- **Ollama itself** (0.40.14), through its OpenAI-compatible endpoint with `reasoning_effort: "none"`. It also scored the same: 67.2%, 45.1%, 21 of 24 and 3 of 3, with a median Ask reply of 1.7 s at 122 tokens a second. It ran at Ollama's existing 57,344-token context, not 8,192, because that context is shared with Stephen's other tools.

For Qwen, Ollama and llama-server are equally accurate and equally fast. Holt connects to either.

LM Studio and every model under it were removed on 9 November 2026. One copy of Qwen remains, in Ollama's store.

## Lessons for the prompts and figures
- **Figures given to the model must carry their direction in words.** The review prompt told the model to drop minus signs, so both models wrote of "a net position" and said "the house account changed by" an amount, and missed that the build-savings account shrank to cover the month's shortfall. Core should name figures by what they mean, such as "the build savings shrank by" or "spent more than came in", and never rely on a sign.
- **Payee names need placeholders,** because names can contain digits ("REMA 1000").
- **The Ask prompt needs every account Holt knows,** including the loans entered by hand. Otherwise "how much is left on the house loan" has nowhere to go.
- **A refund belongs to its job.** Saying so in the job prompt matches the domain model and how the family labels.
- **Hand-written reference replies have to use the household's real job names.** Six of my first references used made-up names and were scored as model errors until they were fixed.

## How Holt as a whole would do
`tools/eval/pipeline.ts` estimates how often Holt would suggest the family's own job, by putting "same as last time" first and leaving each row's own label out. With Qwen through Ollama:
- **"Same as last time"** placed 152 of the 229 rows and got 96.1% of them right.
- **The model** placed the other 77 and got 44.2% right.
- **Holt as a whole:** 78.6% right.

The v1 success measure is that at least 90% of suggested jobs are accepted unchanged by the second month. This sample has one fully labelled month. Real use builds far more "same as last time" history and adds the family's own rules, so this doesn't show Holt missing the target. It does show the model needs help with payees it hasn't seen, which Milestone 3 has to design for. Options include showing it the family's past choices for similar payees, and asking the family instead of suggesting when it's unsure.

## Decision
- **Model:** Qwen 3.8 27B, as decision 0017 expected.
- **Runtime on Stephen's machine:** Ollama, which his own scripts already use. There is one engine and one copy of the model. Holt still connects to whichever runtime a household runs (§6).
- **Removed:** LM Studio with every model under it, and the llama-server built for the bake-off.
- **Changing model later:** `pnpm eval <model>` scores a model on the same tasks and prints it beside the baseline in `private/eval/baseline.json`. Two runs of the same model differed by up to 1.4 points on jobs and not at all on Ask or the reviews, so smaller differences are noise.
