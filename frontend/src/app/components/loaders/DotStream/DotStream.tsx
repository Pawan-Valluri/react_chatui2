import React from 'react';
import './DotStream.scss';

interface DotStreamProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const DotStream: React.FC<DotStreamProps> = ({
  size = 60,
  color = 'black',
  speed = 2.5,
}) => {
  return (
    <div
      className="dot-stream-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="dot-stream-inner">
        <div className="dot-stream-dot" />
        <div className="dot-stream-dot" />
        <div className="dot-stream-dot" />
        <div className="dot-stream-dot" />
        <div className="dot-stream-dot" />
      </div>
    </div>
  );
};
