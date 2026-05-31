import React from 'react';
import './ChaoticOrbit.scss';

interface ChaoticOrbitProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const ChaoticOrbit: React.FC<ChaoticOrbitProps> = ({
  size = 35,
  color = 'black',
  speed = 1.5,
}) => {
  return (
    <div
      className="chaotic-orbit-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="chaotic-orbit-inner" />
    </div>
  );
};
