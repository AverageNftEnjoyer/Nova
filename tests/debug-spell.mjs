import nspell from "nspell";
import dict from "dictionary-en";
const spell = nspell(dict.aff, dict.dic);

function approxEditDist(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 3) return 4;
  const prev2 = new Array(lb + 1).fill(0);
  const prev = Array.from({ length: lb + 1 }, (_, i) => i);
  const curr = new Array(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      curr[j] = Math.min(curr[j-1]+1, prev[j]+1, prev[j-1]+cost);
      if (i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1])
        curr[j] = Math.min(curr[j], prev2[j-2]+cost);
    }
    prev2.splice(0, prev2.length, ...prev);
    prev.splice(0, prev.length, ...curr);
  }
  return Math.min(prev[lb], 3);
}

for (const token of ["shwo", "yrok", "iwll", "opne", "paly"]) {
  const suggs = spell.suggest(token);
  const lower = token.toLowerCase();
  const ranked = suggs
    .map((s, rank) => ({ s, rank, dist: approxEditDist(lower, s.toLowerCase()) }))
    .filter(x => x.dist <= 2)
    .sort((a, b) => a.dist !== b.dist ? a.dist - b.dist : a.rank - b.rank);
  console.log(`${token}: top5=${JSON.stringify(suggs.slice(0,5))} ranked=${JSON.stringify(ranked.slice(0,4))}`);
}
