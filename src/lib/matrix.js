// Matrix/runout inscription default — "<catalogue> <side>", the
// starting text a customer can then overwrite with their own.

export function defaultMatrix(catalogue, side){
  return (catalogue ? catalogue + " " : "") + side;
}
