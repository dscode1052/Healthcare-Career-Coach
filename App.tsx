
import React, { useState, useRef, useEffect } from 'react';
import { Province, FacilityType, InterviewState, Message, Feedback, ROLE_MAP } from './types';
import { startInterview, evaluateResponse, getNextQuestion, generateSarahSpeech, decodeBase64, decodeAudioData } from './services/geminiService';
import { SarahAvatar } from './components/SarahAvatar';
import { FeedbackCard } from './components/FeedbackCard';

const PROVINCES: Province[] = ['Ontario', 'Alberta', 'Manitoba', 'Saskatchewan'];

const App: React.FC = () => {
  const [state, setState] = useState<InterviewState>({
    province: null,
    facility: null,
    step: 'setup',
    messages: [],
    currentQuestionIndex: 0,
    totalQuestions: 20
  });

  const [userInput, setUserInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');

  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [state.messages, loading]);

  // 카메라 스트림 처리 (검은 화면 방지를 위해 videoRef.current 설정 시점 확인)
  useEffect(() => {
    let active = true;
    async function setupCamera() {
      if (showCamera) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (!active) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          cameraStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // 확실하게 재생 시도
            await videoRef.current.play().catch(e => console.warn("Auto-play blocked:", e));
          }
        } catch (err) {
          console.error("Camera access error:", err);
          setShowCamera(false);
          alert("카메라를 켤 수 없습니다. 브라우저의 카메라 권한 설정을 확인해주세요.");
        }
      } else {
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach(track => track.stop());
          cameraStreamRef.current = null;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      }
    }
    setupCamera();
    return () => {
      active = false;
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [showCamera]);

  const getAudioContext = () => {
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    return audioContextRef.current;
  };

  const playSarahVoice = async (base64: string) => {
    if (!base64 || base64.trim() === '') return;
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const audioData = decodeBase64(base64);
      const buffer = await decodeAudioData(audioData, ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
    } catch (e) { console.error("Voice playback error:", e); }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject("Conversion failed");
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const startInterviewFlow = async (p: Province, f: FacilityType) => {
    setLoading(true);
    try {
      const data = await startInterview(p, f);
      const audioBase64 = await generateSarahSpeech(data.sarahReaction);

      setState({
        ...state,
        province: p,
        facility: f,
        step: 'interviewing',
        currentQuestionIndex: 1,
        messages: [{ role: 'sarah', text: data.sarahReaction, audioBase64 }]
      });
      await playSarahVoice(audioBase64);
    } catch (e: any) {
      console.error(e);
      alert(`연결 오류가 발생했습니다: ${e.message || JSON.stringify(e)}`);
    } finally { setLoading(false); }
  };

  const handleSendAnswer = async (manualText?: string, audioBlob?: Blob) => {
    const isVoice = !!audioBlob;
    const initialText = manualText || userInput;
    if (loading || (!initialText && !isVoice)) return;

    setLoading(true);

    // 1. 사용자 메시지 즉시 추가 (음성인 경우 변환 대기 중 표시)
    const userMsg: Message = {
      role: 'user',
      text: isVoice ? "Transcribing your voice..." : initialText,
      isTranscribing: isVoice
    };

    setState(prev => ({ ...prev, messages: [...prev.messages, userMsg] }));
    setUserInput('');

    try {
      let audioData;
      if (audioBlob) {
        const base64 = await blobToBase64(audioBlob);
        audioData = { data: base64, mimeType: audioBlob.type };
      }

      // 히스토리 구성 (현재 전송 중인 메시지 포함)
      const currentHistory = [...state.messages, userMsg].map(m => ({ role: m.role, text: m.text }));

      // 2. AI에게 평가 및 (필요시) 받아쓰기 요청
      const feedback = await evaluateResponse(
        state.province!,
        initialText,
        currentHistory,
        state.currentQuestionIndex,
        audioData
      );

      const audioBase64 = await generateSarahSpeech(feedback.sarahReaction);
      const sarahFeedbackMsg: Message = {
        role: 'sarah',
        text: feedback.sarahReaction,
        expression: feedback.sarahReaction,
        feedback,
        audioBase64
      };

      // 3. 음성인 경우 사용자의 메시지를 실제 받아쓰기 텍스트로 교체하고 Sarah의 피드백 추가
      setState(prev => {
        const updatedMessages = [...prev.messages];
        if (isVoice && feedback.userTranscription) {
          // Corrected: findLastIndex is not available in some older environments.
          // Using a manual loop to find the last index of a user message.
          let lastUserMsgIdx = -1;
          for (let i = updatedMessages.length - 1; i >= 0; i--) {
            if (updatedMessages[i].role === 'user') {
              lastUserMsgIdx = i;
              break;
            }
          }
          if (lastUserMsgIdx !== -1) {
            updatedMessages[lastUserMsgIdx] = {
              ...updatedMessages[lastUserMsgIdx],
              text: feedback.userTranscription,
              isTranscribing: false
            };
          }
        }
        return {
          ...prev,
          step: feedback.isFinished ? 'finished' : 'awaiting_next',
          messages: [...updatedMessages, sarahFeedbackMsg]
        };
      });

      await playSarahVoice(audioBase64);
    } catch (e) {
      console.error(e);
      alert("답변 분석 중 오류가 발생했습니다. 다시 시도해주세요.");
      // 에러 발생 시 transcribing 상태 해제
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(m => m.isTranscribing ? { ...m, text: "(Error in transcription)", isTranscribing: false } : m)
      }));
    } finally { setLoading(false); }
  };

  const proceedToNextQuestion = async () => {
    if (loading) return;
    setLoading(true);
    const nextIdx = state.currentQuestionIndex + 1;
    try {
      const history = state.messages.map(m => ({ role: m.role, text: m.text }));
      const nextQ = await getNextQuestion(state.province!, history, nextIdx);
      const audioBase64 = await generateSarahSpeech(nextQ);

      setState(prev => ({
        ...prev,
        step: 'interviewing',
        currentQuestionIndex: nextIdx,
        messages: [...prev.messages, { role: 'sarah', text: nextQ, audioBase64 }]
      }));
      await playSarahVoice(audioBase64);
    } catch (e) { alert("질문을 불러오지 못했습니다."); } finally { setLoading(false); }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        setMicPermission('granted');
        audioChunksRef.current = [];

        const mimeType = ['audio/webm', 'audio/mp4', 'audio/wav'].find(type => MediaRecorder.isTypeSupported(type)) || '';
        const mr = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mr;
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mr.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          handleSendAnswer(undefined, blob);
          stream.getTracks().forEach(t => t.stop());
        };
        mr.start();
        setIsRecording(true);
        setRecordingTime(0);
        timerRef.current = window.setInterval(() => setRecordingTime(p => p + 1), 1000);
      } catch (e) {
        setMicPermission('denied');
        alert("마이크 권한이 거부되었습니다. 텍스트 입력을 사용해주세요.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8 font-sans">
      <header className="w-full max-w-5xl mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Sarah's <span className="text-sky-500">Career Coach</span></h1>
          <p className="text-sm text-slate-500 font-medium">Healthcare Interview Simulator (20-Question Series)</p>
        </div>
        {state.step !== 'setup' && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Progress</span>
              <span className="text-xs font-black text-sky-600">{state.currentQuestionIndex} / {state.totalQuestions}</span>
            </div>
            <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${(state.currentQuestionIndex / state.totalQuestions) * 100}%` }}></div>
            </div>
          </div>
        )}
      </header>

      {state.step === 'setup' ? (
        <main className="w-full max-w-xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100 text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="w-16 h-16 bg-sky-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Start Your Comprehensive Interview</h2>
          <p className="text-slate-500 mb-8 text-sm leading-relaxed">준비된 20개의 핵심 질문을 통해 임상 능력, 의사소통, 상황 대응 능력을 평가받으세요. Sarah가 당신의 새로운 도전을 응원합니다.</p>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {PROVINCES.map(p => (
              <button key={p} onClick={() => setState({ ...state, province: p })} className={`p-4 rounded-xl border-2 text-left transition-all ${state.province === p ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-100' : 'border-slate-100 hover:border-slate-200'}`}>
                <div className="font-bold text-slate-700">{p}</div>
                <div className="text-[10px] text-slate-400 uppercase font-black">{ROLE_MAP[p]}</div>
              </button>
            ))}
          </div>

          <button disabled={!state.province || loading} onClick={() => startInterviewFlow(state.province!, 'LTC')} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg active:scale-95">
            {loading ? 'Entering Office...' : 'Begin 20-Question Interview'}
          </button>
        </main>
      ) : (
        <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <aside className="lg:col-span-3 flex flex-col gap-4">
            <SarahAvatar expression={state.messages[state.messages.length - 1]?.expression} />
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase">Self Monitor</span>
                <button onClick={() => setShowCamera(!showCamera)} className="text-[9px] bg-slate-100 px-2 py-1 rounded font-bold">{showCamera ? 'OFF' : 'ON'}</button>
              </div>
              <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden relative">
                {showCamera ? <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover mirror" /> : <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-xs text-center p-2">Click 'ON' to see your camera</div>}
              </div>
            </div>
          </aside>

          <section className="lg:col-span-9 flex flex-col bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden h-[700px]">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
              {state.messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-5 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-800 rounded-tl-none'}`}>
                    <p className={`text-sm md:text-base leading-relaxed whitespace-pre-wrap ${msg.isTranscribing ? 'italic opacity-60 animate-pulse' : ''}`}>
                      {msg.text}
                    </p>
                    {msg.audioBase64 && <button onClick={() => playSarahVoice(msg.audioBase64!)} className="mt-2 text-sky-500 text-xs font-bold uppercase flex items-center gap-1 hover:text-sky-700"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg> Replay Audio</button>}
                  </div>
                  {msg.feedback && <FeedbackCard feedback={msg.feedback} />}
                </div>
              ))}
              {loading && <div className="p-4 text-xs font-bold text-sky-600 animate-pulse tracking-widest uppercase text-center">Sarah is thinking...</div>}
            </div>

            <div className="p-6 bg-white border-t border-slate-100">
              {state.step === 'awaiting_next' ? (
                <div className="flex flex-col items-center gap-4 animate-in slide-in-from-bottom-4">
                  <p className="text-sm font-medium text-slate-500">피드백을 모두 확인하셨나요? 다음 질문을 받으려면 아래 버튼을 누르세요.</p>
                  <button onClick={proceedToNextQuestion} disabled={loading} className="px-10 py-4 bg-sky-500 text-white rounded-2xl font-bold hover:bg-sky-600 shadow-lg shadow-sky-100 transition-all flex items-center gap-3 active:scale-95">
                    {loading ? 'Preparing...' : 'Next Question (다음 질문 받기)'}
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </button>
                </div>
              ) : state.step === 'finished' ? (
                <div className="text-center p-4">
                  <h3 className="text-xl font-bold text-slate-800 mb-2">Interview Complete!</h3>
                  <p className="text-slate-500 mb-4">수고하셨습니다! 인터뷰의 모든 과정을 마치셨습니다. Sarah의 조언을 복기하며 성공적인 취업을 준비하세요.</p>
                  <button onClick={() => window.location.reload()} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all">Restart (처음부터 다시 연습)</button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4 justify-center">
                    <button onClick={toggleRecording} disabled={loading} className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl group ${isRecording ? 'bg-red-500 animate-pulse scale-110' : micPermission === 'denied' ? 'bg-slate-200 cursor-not-allowed' : 'bg-sky-500 hover:bg-sky-600 shadow-sky-100'}`}>
                      {isRecording ? <div className="w-6 h-6 bg-white rounded-sm"></div> : <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}
                    </button>
                    {isRecording && <span className="text-2xl font-mono font-bold text-red-500">{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>}
                  </div>
                  <p className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">{micPermission === 'denied' ? 'Mic access denied. Please type your answer.' : isRecording ? 'Recording your answer...' : 'Click to Speak (음성 답변)'}</p>

                  <div className="flex gap-2 border-t pt-4">
                    <input type="text" value={userInput} onChange={e => setUserInput(e.target.value)} disabled={loading} onKeyDown={e => e.key === 'Enter' && handleSendAnswer()} placeholder={micPermission === 'denied' ? "Type your answer here..." : "Or type your response..."} className="flex-1 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-sky-200 outline-none transition-all" />
                    <button onClick={() => handleSendAnswer()} disabled={loading || !userInput.trim()} className="px-6 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors">Submit</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      <style>{`
        .mirror { transform: scaleX(-1); }
        @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.5s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default App;
