import React from "react";

interface MeterProps {
    label: string;
    value: number;
    max: number;
}

const Meter: React.FC<MeterProps> = ({ label, value, max }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;

    return (
        <div className="meter">
            <div className="label">{label}</div>
            <div className="bar">
                <div className="fill" style={{ width: `${percentage}%` }}></div>
            </div>
        </div>
    );
};

const Meters = () => {
  return (
    <div className="meters">
      <h2>Meters</h2>
      <p>Metrics and statistics will be displayed here.</p>
    </div>
  );
};

export default Meters;
