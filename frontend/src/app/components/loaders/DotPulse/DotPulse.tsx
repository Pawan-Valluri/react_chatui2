import React from 'react';
import './DotPulse.scss';

interface DotPulseProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const DotPulse: React.FC<DotPulseProps> = ({
  size = 43,
  color = 'black',
  speed = 1.3,
}) => {
  return (
    <div
      className="dot-pulse-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="dot-pulse-inner">
        <div className="dot-pulse-dot" />
      </div>
    </div>
  );
};
