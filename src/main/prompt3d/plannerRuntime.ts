import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { savePlannerHost } from "./controlsPreference";

const HOST = "http://127.0.0.1:11435";
let owned: ChildProcess | null = null;
let starting: Promise<string> | null = null;

async function healthy() {
  try { const response=await fetch(`${HOST}/api/version`,{signal:AbortSignal.timeout(1000)}); return response.ok && typeof (await response.json() as {version?:unknown}).version === "string"; } catch {return false;}
}

/** Explicit UI action only. Reuse installed weights; never pull a model. */
export function startCpuPlanner(): Promise<string> {
  if (starting) return starting;
  starting=(async()=>{
    if(await healthy())return savePlannerHost(HOST);
    if(process.platform!=="win32")throw new Error("Start your installed Ollama service and save its loopback URL.");
    const executable=join(process.env.LOCALAPPDATA??"", "Programs", "Ollama", "ollama.exe");
    if(!existsSync(executable))throw new Error("Native Ollama is not installed. No download was started.");
    const env: NodeJS.ProcessEnv = {};
    for(const key of ["PATH","SystemRoot","SYSTEMROOT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","OLLAMA_MODELS"])if(process.env[key])env[key]=process.env[key];
    owned=spawn(executable,["serve"],{windowsHide:true,stdio:"ignore",shell:false,env:{...env,OLLAMA_HOST:"127.0.0.1:11435",CUDA_VISIBLE_DEVICES:"-1",OLLAMA_MAX_LOADED_MODELS:"1",OLLAMA_NUM_PARALLEL:"1"}});
    let error: Error | null=null;owned.once("error",e=>{error=e;});
    for(let i=0;i<40;i++){if(error)throw error;if(await healthy())return savePlannerHost(HOST);await new Promise(r=>setTimeout(r,250));}
    owned?.kill();owned=null;throw new Error("Installed CPU planner did not start. Check that port 11435 is free and model storage is available.");
  })().finally(()=>{starting=null;});
  return starting;
}

export function stopOwnedCpuPlanner() { owned?.kill();owned=null; }
