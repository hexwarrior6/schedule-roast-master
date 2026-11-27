type Env = Record<string,string|undefined>;
type Stage = "VISION"|"REVIEW";
export type AIConfig = {baseURL:string;apiKey:string;model:string;openRouter:boolean};
const defaultBase="https://api.openai.com/v1";
export function resolveAIConfig(stage:Stage,env:Env):AIConfig|null {
  const sharedBase=(env.AI_BASE_URL?.trim()||defaultBase).replace(/\/+$/,"");
  const baseURL=(env["AI_"+stage+"_BASE_URL"]?.trim()||sharedBase).replace(/\/+$/,"");
  const model=env["AI_"+stage+"_MODEL"]?.trim()||env.AI_MODEL?.trim();
  const openRouter=baseURL==="https://openrouter.ai/api/v1";
  const apiKey=env["AI_"+stage+"_API_KEY"]?.trim()
    ||(openRouter?env.OPENROUTER_API_KEY?.trim():undefined)
    ||(baseURL===sharedBase?env.AI_API_KEY?.trim():undefined);
  // Never fall back to a shared key when the stage points to a different endpoint.
  if(!model||!apiKey)return null;
  return {baseURL,apiKey,model,openRouter};
}
export function completionLimit(config:AIConfig,n:number){
  return config.openRouter || /^gpt-5(?:[.\-]|$)|^o[1-9](?:[.\-]|$)/.test(config.model)
    ? {max_completion_tokens:n}:{max_tokens:n};
}
