
import React from 'react';
import { Feedback } from '../types';

interface FeedbackCardProps {
  feedback: Feedback;
}

export const FeedbackCard: React.FC<FeedbackCardProps> = ({ feedback }) => {
  return (
    <div className="mt-4 p-5 bg-gradient-to-br from-white to-sky-50 rounded-xl border-l-4 border-sky-400 shadow-md">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold uppercase text-sky-600 tracking-widest">Clinical Feedback (상세 평가)</span>
        <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-600">Score:</span>
            <span className={`text-xl font-bold ${feedback.score >= 8 ? 'text-green-600' : 'text-orange-500'}`}>
                {feedback.score}/10
            </span>
        </div>
      </div>
      
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-bold text-slate-700 mb-1">✅ Strengths (강점)</h4>
          <p className="text-sm text-slate-600 leading-relaxed">{feedback.strengths}</p>
        </div>
        
        <div>
          <h4 className="text-sm font-bold text-slate-700 mb-1">💡 Areas for Improvement (개선할 점 및 관련 법규)</h4>
          <p className="text-sm text-slate-600 leading-relaxed">{feedback.areasForImprovement}</p>
        </div>

        <div className="pt-4 border-t border-sky-200">
          <h4 className="text-sm font-bold text-sky-800 mb-2">✨ Refined Model Answer (STAR Method)</h4>
          <div className="bg-white/60 p-3 rounded-lg border border-sky-100 italic text-sm text-slate-700 leading-relaxed">
            {feedback.refinedAnswer}
          </div>
        </div>
      </div>
    </div>
  );
};
