import {describe,it,expect} from "vitest";
import {resolveAIConfig,completionLimit} from "./ai-config";
describe("独立模型端点配置",()=>{
  it("兼容旧的共享配置",()=>{
    const env={AI_API_KEY:"test",AI_MODEL:"gpt-4o"};
    expect(resolveAIConfig("VISION",env)).toEqual(resolveAIConfig("REVIEW",env));
    expect(resolveAIConfig("VISION",env)?.model).toBe("gpt-4o");
  });
  it("两个 OpenRouter 模型共享专用 key",()=>{
    const env={AI_API_KEY:"old",AI_MODEL:"gpt-4o",OPENROUTER_API_KEY:"new",AI_VISION_BASE_URL:"https://openrouter.ai/api/v1",AI_REVIEW_BASE_URL:"https://openrouter.ai/api/v1",AI_VISION_MODEL:"nvidia/vl:free",AI_REVIEW_MODEL:"nvidia/ultra:free"};
    expect(resolveAIConfig("VISION",env)?.apiKey).toBe("new");
    expect(resolveAIConfig("REVIEW",env)?.model).toBe("nvidia/ultra:free");
    expect(resolveAIConfig("VISION",{...env,OPENROUTER_API_KEY:undefined})).toBeNull();
  });
  it("独立供应商不能误用共享密钥",()=>{
    expect(resolveAIConfig("REVIEW",{AI_API_KEY:"old",AI_MODEL:"gpt-4o",AI_REVIEW_BASE_URL:"https://example.com/v1"})).toBeNull();
  });
  it("支持 GPT-5 和 OpenRouter completion token 参数",()=>{
    const cfg=resolveAIConfig("VISION",{AI_API_KEY:"test",AI_MODEL:"gpt-5.4"})!;
    expect(completionLimit(cfg,123)).toEqual({max_completion_tokens:123});
    expect(completionLimit({...cfg,model:"gpt-4o"},123)).toEqual({max_tokens:123});
  });
});
