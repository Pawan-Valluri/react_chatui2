import React from 'react';
import './Helix.scss';

interface HelixProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const Helix: React.FC<HelixProps> = ({
  size = 45,
  color = 'black',
  speed = 2.5,
}) => {
  return (
    <div
      className="helix-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="helix-inner">
        <div className="helix-slice" />
        <div className="helix-slice" />
        <div className="helix-slice" />
        <div className="helix-slice" />
        <div className="helix-slice" />
        <div className="helix-slice" />
      </div>
    </div>
  );
};
