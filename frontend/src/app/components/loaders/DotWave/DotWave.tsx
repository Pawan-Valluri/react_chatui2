import React from 'react';
import './DotWave.scss';

interface DotWaveProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const DotWave: React.FC<DotWaveProps> = ({
  size = 47,
  color = 'black',
  speed = 1,
}) => {
  return (
    <div
      className="dot-wave-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="dot-wave-inner">
        <div className="dot-wave-dot" />
        <div className="dot-wave-dot" />
        <div className="dot-wave-dot" />
        <div className="dot-wave-dot" />
      </div>
    </div>
  );
};
