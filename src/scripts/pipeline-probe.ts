import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runPipelineProbe } from "../src/core/pipeline-probe";

const duration = Number(process.argv[2] ?? 10000);
const file = join(tmpdir(), `ect-pipeline-${randomUUID()}.jsonl`);
runPipelineProbe(file, duration).then(result => {
  console.log(JSON.stringify({ ...result, recording: file }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });
