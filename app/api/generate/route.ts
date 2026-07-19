export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return Response.json({error:"请先输入 API Key"},{status:401});
  try {
    const {library,mode,count,weakWords} = await request.json();
    const prompt = `Create ${Math.min(Number(count)||5,10)} ${library} English vocabulary multiple-choice questions. Mode: ${mode === "cloze" ? "sentence cloze with four English word options" : "English word with four Chinese meaning options"}. ${weakWords?.length ? `Prioritize these weak words: ${weakWords.join(", ")}.` : "Use representative exam vocabulary."} Return valid JSON only as {"questions":[{"word":"","phonetic":"IPA","sentence":"required for cloze only","options":["","","",""],"answer":0,"example":"short natural English example"}]}. answer is a zero-based index. Exactly four distinct options.`;
    const response = await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":authorization},body:JSON.stringify({model:"gpt-4.1-mini",temperature:.7,response_format:{type:"json_object"},messages:[{role:"system",content:"You are an expert vocabulary-test writer. Produce accurate, unambiguous questions and valid JSON only."},{role:"user",content:prompt}]})});
    const data = await response.json() as {choices?:Array<{message?:{content?:string}}>;error?:{message?:string}};
    if (!response.ok) return Response.json({error:data.error?.message || "OpenAI 请求失败"},{status:response.status});
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    if (!Array.isArray(parsed.questions)) throw new Error("返回格式不正确");
    return Response.json({questions:parsed.questions});
  } catch (error) { return Response.json({error:error instanceof Error?error.message:"生成失败"},{status:500}); }
}
