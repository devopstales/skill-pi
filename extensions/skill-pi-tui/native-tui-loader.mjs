import mod from "./index.ts";
if (typeof mod !== "function" && typeof mod !== "object") {
  throw new Error("expected index.ts default export to be a function or module namespace");
}
console.log("ok");
