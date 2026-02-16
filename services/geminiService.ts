
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Feedback, Province, FacilityType, ROLE_MAP } from "../types";

// Corrected: Initializing GoogleGenAI with process.env.API_KEY directly as per guidelines.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const getSystemInstruction = (province: Province, role: string) => `
You are "Sarah," a compassionate but professional Director of Care at a Long-Term Care facility.
Role: Expert Healthcare Recruiter & Career Coach.
Candidate: A CCA graduate from Nova Scotia relocating to ${province}.
Current Target Role: ${role}.

CORE OBJECTIVE: Conduct a comprehensive 20-question job interview, one question at a time.

INTERACTION PHASES:
1. EVALUATION PHASE (STRICT): 
   - When a user provides a text or voice answer, you MUST evaluate it.
   - If audio is provided, you MUST transcribe it exactly in the "userTranscription" field.
   - In "sarahReaction", ONLY give a conversational response to their answer (e.g., "That's a very practical approach...").
   - IMPORTANT: DO NOT ASK A NEW QUESTION IN THE EVALUATION PHASE. STOP AFTER THE REACTION.

2. QUESTION PHASE:
   - When explicitly asked for the "next question", provide ONLY the question text.

Sarah's Persona: Professional scrubs, bright office. Visuals: [Sarah nods], [Sarah smiles], [Sarah looks thoughtful].
Language:
- Sarah's dialogue (sarahReaction and next question): ENGLISH ONLY.
- Evaluation (strengths, areasForImprovement): KOREAN ONLY.
- Score: Integer between 0 and 10 (e.g., 7, 8, 9). NEVER use decimals like 0.8.
- Areas for Improvement: Must be specific, actionable, and detailed. Point out exactly what handled poorly (e.g., missing safety step, lack of empathy, vague terminology) and how to fix it.
- Refined Answer (refinedAnswer): MUST provide the Model Answer in ENGLISH first (STAR Method), followed by its KOREAN translation.
`;

export const startInterview = async (province: Province, facility: FacilityType): Promise<any> => {
  const role = ROLE_MAP[province];
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: `Start the interview. Introduce yourself briefly and ask Question #1 clearly.` }],
      }
    ],
    config: {
      systemInstruction: { parts: [{ text: getSystemInstruction(province, role) }] },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sarahReaction: { type: Type.STRING, description: "Greeting and Question 1" },
        },
        required: ["sarahReaction"],
      },
    },
  });

  if (response.text) {
    return JSON.parse(response.text.trim());
  }
  throw new Error("No response from AI");
};

export const evaluateResponse = async (
  province: Province,
  userAnswer: string,
  history: { role: string, text: string }[],
  currentQuestionIndex: number,
  audioData?: { data: string, mimeType: string }
): Promise<Feedback> => {
  const role = ROLE_MAP[province];
  const chatHistory = history.map(h => `${h.role}: ${h.text}`).join('\n');

  const parts: any[] = [
    { text: `User's current response for Question ${currentQuestionIndex}: "${userAnswer}"\n\nTASK: Evaluate this answer. If audio is attached, use it to transcribe their answer. DO NOT ask a new question.` }
  ];

  if (audioData) {
    parts.push({
      inlineData: {
        data: audioData.data,
        mimeType: audioData.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: parts
      }
    ],
    config: {
      systemInstruction: { parts: [{ text: getSystemInstruction(province, role) }] },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          userTranscription: { type: Type.STRING, description: "Exactly what the user said in the audio (if provided). If text-only, repeat the user input." },
          sarahReaction: { type: Type.STRING, description: "Sarah's short reaction to the answer. MUST NOT contain a question." },
          score: { type: Type.NUMBER },
          strengths: { type: Type.STRING },
          areasForImprovement: { type: Type.STRING },
          refinedAnswer: { type: Type.STRING },
          isFinished: { type: Type.BOOLEAN },
        },
        required: ["userTranscription", "sarahReaction", "score", "strengths", "areasForImprovement", "refinedAnswer", "isFinished"],
      },
    },
  });

  if (response.text) {
    return JSON.parse(response.text.trim()) as Feedback;
  }
  throw new Error("No response from AI");
};

export const getNextQuestion = async (
  province: Province,
  history: { role: string, text: string }[],
  nextIndex: number
): Promise<string> => {
  const role = ROLE_MAP[province];
  const chatHistory = history.map(h => `${h.role}: ${h.text}`).join('\n');

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: `Next Question Task: Provide Question #${nextIndex} of 20. History:\n${chatHistory}` }]
      }
    ],
    config: {
      systemInstruction: { parts: [{ text: getSystemInstruction(province, role) }] },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING, description: "The next interview question text." }
        },
        required: ["question"]
      }
    }
  });

  if (response.text) {
    return JSON.parse(response.text.trim()).question;
  }
  throw new Error("No response from AI");
};

export const generateSarahSpeech = async (text: string): Promise<string> => {
  const dialogueOnly = text.replace(/\[.*?\]/g, '').trim();
  if (!dialogueOnly) return "";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [
        {
          role: "user",
          parts: [{ text: dialogueOnly }],
        }
      ],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      console.warn("TTS response had no audio data");
      return "";
    }
    return base64Audio;
  } catch (error) {
    console.error("TTS Generation Error:", error);
    return ""; // Fail gracefully without crashing the app
  }
};

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number = 24000, numChannels: number = 1): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}
