// One audio file's facts, as the plant's check read them (plant/checks.py),
// in the words of the form's file line.
import { formatTime } from "./time.js";

export function audioFactsText(file){
  if(file.error) return file.error;
  const khz = file.sampleRate ? `${file.sampleRate / 1000} kHz` : "";
  const format = [file.codec, khz, file.bitsPerSample && `${file.bitsPerSample} bit`].filter(Boolean).join(" ");
  return [file.duration > 0 ? formatTime(file.duration) : "", format].filter(Boolean).join(" · ");
}
