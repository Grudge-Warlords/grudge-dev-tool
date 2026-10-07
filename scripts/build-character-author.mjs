import {build} from "esbuild";

// Three's runtime geometry utilities live under examples/, which the package
// intentionally excludes. Bundle this CPU author with its exact dependencies
// so the installed prompt runner has the same implementation as the checkout.
await build({
  entryPoints:["src/main/prompt3d/characterSurface.ts"],
  outfile:"dist/main/prompt3d/characterSurface.js",
  bundle:true,platform:"node",format:"cjs",target:"node22",
  external:["./characterRig"],sourcemap:true,sourcesContent:false,logLevel:"info",
});
