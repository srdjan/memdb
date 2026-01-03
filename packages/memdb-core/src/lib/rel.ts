import * as path from "@std/path";

export const relLink = (fromFileAbs: string, toFileAbs: string): string => {
  const fromDir = path.dirname(fromFileAbs);
  let rel = path.relative(fromDir, toFileAbs);
  // normalize for markdown
  rel = rel.split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
};
