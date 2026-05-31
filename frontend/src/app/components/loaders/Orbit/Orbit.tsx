import React from 'react';
import './Orbit.scss';

interface OrbitProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const Orbit: React.FC<OrbitProps> = ({
  size = 35,
  color = 'black',
  speed = 1.5,
}) => {
  return (
    <div
      className="orbit-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="orbit-inner" />
    </div>
  );
};
