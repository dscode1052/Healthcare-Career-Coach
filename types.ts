
export type Province = 'Ontario' | 'Alberta' | 'Manitoba' | 'Saskatchewan';
export type FacilityType = 'LTC' | 'Home Care' | 'Hospital';

export const ROLE_MAP: Record<Province, string> = {
  'Ontario': 'PSW (Personal Support Worker)',
  'Alberta': 'HCA (Health Care Aide)',
  'Manitoba': 'HCA (Health Care Aide)',
  'Saskatchewan': 'CCA (Continuing Care Assistant)'
};

export interface Feedback {
  score: number;
  strengths: string;
  areasForImprovement: string;
  refinedAnswer: string;
  sarahReaction: string;
  userTranscription?: string; // 음성 답변의 텍스트 변환 결과
  isFinished: boolean;
}

export interface Message {
  role: 'sarah' | 'user';
  text: string;
  expression?: string;
  feedback?: Feedback;
  audioBase64?: string;
  isTranscribing?: boolean; // 변환 중 상태 표시용
}

export interface InterviewState {
  province: Province | null;
  facility: FacilityType | null;
  step: 'setup' | 'interviewing' | 'awaiting_next' | 'finished';
  messages: Message[];
  currentQuestionIndex: number;
  totalQuestions: number;
}
