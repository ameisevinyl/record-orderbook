export function requiredFileIssue(label, state){
  if(!state.file) return {text:`${label} artwork file is missing.`, blocking:true};
  if(state.pending) return {text:`${label} artwork inspection is still pending.`, blocking:true, pending:true};
  if(state.error) return {text:`${label} artwork could not be read.`, blocking:true};
  if(state.rows.some(row => row.severity === "error")){
    return {text:`${label} artwork has checklist errors.`, blocking:true};
  }
  if(state.rows.some(row => row.severity === "warn")){
    return {text:`${label} artwork has checklist warnings.`, blocking:false};
  }
  return null;
}
