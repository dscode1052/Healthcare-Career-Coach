
import React from 'react';

interface SarahAvatarProps {
  expression?: string;
}

export const SarahAvatar: React.FC<SarahAvatarProps> = ({ expression }) => {
  return (
    <div className="flex flex-col items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
      <div className="relative w-32 h-32 rounded-full bg-sky-50 flex items-center justify-center border-4 border-sky-100 overflow-hidden mb-4">
         <img 
            src="https://picsum.photos/seed/sarah-recruiter/200/200" 
            alt="Sarah" 
            className="w-full h-full object-cover"
         />
      </div>
      <h3 className="text-lg font-bold text-slate-800">Sarah</h3>
      <p className="text-xs font-medium text-sky-600 mb-2 uppercase tracking-wider">Director of Care</p>
      {expression && (
        <div className="text-center italic text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 animate-fade-in">
          "{expression.replace(/\[|\]/g, '')}"
        </div>
      )}
    </div>
  );
};
