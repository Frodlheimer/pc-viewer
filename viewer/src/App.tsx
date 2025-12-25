import DeckGL from "@deck.gl/react";
import { PointCloudLayer } from "@deck.gl/layers";
import { OrbitView } from "@deck.gl/core";
import { useState } from "react";


type Point = {
  position: [number, number, number];
  color: [number, number, number];
};

const points: Point[] = Array.from({ length: 50_000 }, () => {
  // Punkte in einer Würfelwolke um den Ursprung
  const x = (Math.random() - 0.5) * 200;
  const y = (Math.random() - 0.5) * 200;
  const z = (Math.random() - 0.5) * 100;

  // Einfärbung nach Höhe (z) als schnelle Demo
  const t = (z + 50) / 100; // 0..1
  const r = Math.round(255 * t);
  const g = Math.round(255 * (1 - t));
  const b = 160;

  return { position: [x, y, z], color: [r, g, b] };
});


const layer = new PointCloudLayer<Point>({
  id: "pointcloud",
  data: points,
  pickable: true,
  autoHighlight: true,
  getPosition: d => d.position,
  getColor: d => d.color,
  pointSize: 10,
});


export default function App() {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <DeckGL
        views={new OrbitView()}
        initialViewState={{
          target: [0, 0, 0],
          zoom: 0,
          rotationX: 30,
          rotationOrbit: 30,
        }}
        controller={true}
        layers={[layer]}
        onHover={(info) => {
          if (info.object) {
            const p = info.object as Point;
            setHover({
              x: info.x ?? 0,
              y: info.y ?? 0,
              text: `x=${p.position[0].toFixed(1)} y=${p.position[1].toFixed(1)} z=${p.position[2].toFixed(1)}`,
            });
          } else {
            setHover(null);
          }
        }}
      />

      {hover && (
        <div
          style={{
            position: "absolute",
            left: hover.x + 12,
            top: hover.y + 12,
            padding: "6px 8px",
            background: "rgba(0,0,0,0.7)",
            color: "white",
            fontFamily: "sans-serif",
            fontSize: 12,
            borderRadius: 6,
            pointerEvents: "none",
          }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}
