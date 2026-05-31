import React from 'react';
import './Grid.scss';

interface GridProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const Grid: React.FC<GridProps> = ({
  size = 60,
  color = 'black',
  speed = 1.5,
}) => {
  return (
    <div
      className="grid-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="grid-inner">
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
        <div className="grid-dot" />
      </div>
    </div>
  );
};
