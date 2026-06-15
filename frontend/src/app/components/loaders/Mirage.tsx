import React from 'react';
import './Mirage.scss';

interface MirageProps {
  size?: number | string;
  color?: string;
  speed?: number | string;
}

export const Mirage: React.FC<MirageProps> = ({
  size = 60,
  color = 'black',
  speed = 2.5,
}) => {
  const sizeInt = parseInt(size + '');
  const height = sizeInt * 0.23;

  return (
    <div
      className="mirage-container"
      style={{
        '--uib-size': size + 'px',
        '--uib-color': color,
        '--uib-speed': speed + 's',
      } as React.CSSProperties}
    >
      <div className="mirage-inner">
        <svg
          className="mirage-svg"
          x="0px"
          y="0px"
          viewBox={`0 0 ${size} ${height}`}
          height={height}
          width={size}
          preserveAspectRatio="xMidYMid meet"
        >
          <circle className="mirage-dot" />
          <circle className="mirage-dot" />
          <circle className="mirage-dot" />
          <circle className="mirage-dot" />
          <circle className="mirage-dot" />
          <defs>
            <filter id="uib-mirage-filter">
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation={sizeInt / 20}
                result="blur"
              />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
                result="ooze"
              />
              <feBlend in="SourceGraphic" in2="ooze" />
            </filter>
          </defs>
        </svg>
      </div>
    </div>
  );
};
