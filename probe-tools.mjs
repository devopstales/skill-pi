const repoRoot = "/Users/paladm/git/ai-test/skill-pi";
process.env.PI_CODING_AGENT_DIR = `${repoRoot}/.skill-pi/agent`;

const { loadExtensions, createExtensionRuntime } = await import(`${repoRoot}/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`);
const { createEventBus } = await import(`${repoRoot}/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js`);

const paths = ["todo", "ask-user", "file-search", "permission"].map((n) => `${repoRoot}/extensions/${n}/index.ts`);
const result = await loadExtensions(paths, repoRoot, createEventBus(), createExtensionRuntime());

for (const err of result.errors ?? []) console.log("LOAD ERROR:", err);
for (const ext of result.extensions) {
  console.log(`extension ${ext.path}:`);
  for (const [name, t] of ext.tools) {
    const si = t.sourceInfo;
    console.log(`  tool=${name} path=${JSON.stringify(si.path)} source=${si.source} scope=${si.scope} origin=${si.origin}`);
    const pass = si.path.startsWith("/") && si.source === "local" && !t.definition?.namespace;
    console.log(`  -> auto-allow filter passes: ${pass}`);
  }
  if (ext.tools.size === 0) console.log("  (no tools)");
}
