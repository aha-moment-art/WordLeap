type Provider = "deepseek" | "kimi" | "gemini";
function cleanJson(text: string) { return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); }
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return Response.json({error:"请先输入 API Key"},{status:401});
  try {
    const {provider="deepseek",library,count,weakWords} = await request.json() as {provider:Provider;library:string;count:number;weakWords:string[]};
    if (!["deepseek","kimi","gemini"].includes(provider)) return Response.json({error:"不支持的 AI 服务商"},{status:400});
    const prompt = `Create ${Math.min(Number(count)||5,10)} ${library} English vocabulary multiple-choice questions: show one English word with four Chinese meaning options. ${weakWords?.length ? `Prioritize these weak words: ${weakWords.join(", ")}.` : "Use representative exam vocabulary."} Return valid JSON only as {"questions":[{"word":"","phonetic":"IPA","options":["","","",""],"answer":0,"example":"short natural English example"}]}. answer is zero-based. Exactly four distinct options.`;
    const key = authorization.slice(7); let response: Response; let content = "";
    if (provider === "gemini") {
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({system_instruction:{parts:[{text:"You are an expert vocabulary-test writer. Return accurate JSON only."}]},contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});
      const data = await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>;error?:{message?:string}};
      if (!response.ok) return Response.json({error:data.error?.message||"Gemini 请求失败"},{status:response.status});
      content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      const config = provider === "kimi" ? {url:"https://api.moonshot.cn/v1/chat/completions",model:"kimi-k3"} : {url:"https://api.deepseek.com/chat/completions",model:"deepseek-v4-flash"};
      response = await fetch(config.url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":authorization},body:JSON.stringify({model:config.model,temperature:.7,response_format:{type:"json_object"},messages:[{role:"system",content:"You are an expert vocabulary-test writer. Produce accurate, unambiguous questions and valid JSON only."},{role:"user",content:prompt}]})});
      const data = await response.json() as {choices?:Array<{message?:{content?:string}}>;error?:{message?:string}};
      if (!response.ok) return Response.json({error:data.error?.message||`${provider === "kimi" ? "Kimi" : "DeepSeek"} 请求失败`},{status:response.status});
      content = data.choices?.[0]?.message?.content || "";
    }
    const parsed = JSON.parse(cleanJson(content));
    if (!Array.isArray(parsed.questions)) throw new Error("服务商返回的题目格式不正确");
    return Response.json({questions:parsed.questions});
  } catch (error) { return Response.json({error:error instanceof Error?error.message:"生成失败"},{status:500}); }
}
