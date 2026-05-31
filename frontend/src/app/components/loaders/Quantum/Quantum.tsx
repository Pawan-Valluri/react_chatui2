import React from 'react';
import './Quantum.scss';

interface QuantumProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const Quantum: React.FC<QuantumProps> = ({
  size = 45,
  color = 'black',
  speed = 1.75,
}) => {
  return (
    <div
      className="quantum-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="quantum-inner">
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
        <div className="quantum-particle" />
      </div>
    </div>
  );
};
