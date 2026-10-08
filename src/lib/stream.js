// A check streams one JSON object per line: its steps, then
// {"result": …} or {"error": …}.
export async function readStream(res, onStep){
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for(;;){
    const {done, value} = await reader.read();
    buffer += value || "";
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for(const line of lines.filter(Boolean)){
      const msg = JSON.parse(line);
      if("result" in msg) return msg.result;
      if(msg.error) throw new Error(msg.error);
      onStep(msg);
    }
    if(done) throw new Error("the check ended without a result");
  }
}
