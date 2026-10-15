export function emulate(raw, cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
  let x = 0, y = 0, i = 0;
  const put = (ch) => { if (x < cols && y < rows) grid[y][x] = ch; x++; if (x >= cols) { x = 0; y = Math.min(rows-1, y+1); } };
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\x1b") {
      if (raw[i+1] === "[") {
        let j = i+2, seq = "";
        while (j < raw.length && !((raw.charCodeAt(j) >= 0x40 && raw.charCodeAt(j) <= 0x7e))) { seq += raw[j]; j++; }
        const fin = raw[j]; j++;
        const m = seq.match(/(\d+);?(\d+)?/);
        const n1 = m && m[1] !== undefined ? parseInt(m[1],10) : 1;
        const n2 = m && m[2] !== undefined ? parseInt(m[2],10) : 1;
        if (fin === "H" || fin === "f") { y = Math.min(rows-1,(n1||1)-1); x = Math.min(cols-1,(n2||1)-1); }
        else if (fin === "A") y = Math.max(0, y-(n1||1));
        else if (fin === "B") y = Math.min(rows-1, y+(n1||1));
        else if (fin === "C") x = Math.min(cols-1, x+(n1||1));
        else if (fin === "D") x = Math.max(0, x-(n1||1));
        else if (fin === "J") { if (n1===2||n1===0) for (let r=0;r<rows;r++) grid[r].fill(" "); else for (let r=y;r<rows;r++) grid[r].fill(" "); }
        else if (fin === "K") { if (n1===0) for (let c2=x;c2<cols;c2++) grid[y][c2]=" "; else if (n1===2) for (let c2=0;c2<=x;c2++) grid[y][c2]=" "; }
        i = j; continue;
      } else if (raw[i+1] === "]") { let j = i+2; while (j < raw.length && raw[j] !== "\x07" && !(raw[j]==="\x1b"&&raw[j+1]==="\\")) j++; i = j + (raw[j]==="\x07"?1:2); continue; }
      else { i += 2; continue; }
    } else if (c === "\r") { x = 0; i++; }
    else if (c === "\n") { y = Math.min(rows-1, y+1); i++; }
    else { if (c.charCodeAt(0) < 32) { i++; continue; } put(c); i++; }
  }
  return grid;
}
