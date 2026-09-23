import { ImageResponse } from "next/og";
export const alt = "Ensemblis — Your music. Understood.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#080b09",
          color: "#f6f8f4",
          padding: "65px 80px",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: -1 }}>
          ensemblis
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 95,
            lineHeight: 1.05,
            letterSpacing: -5,
          }}
        >
          <span>Your music.</span>
          <span style={{ color: "#b7f36a" }}>Understood.</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: "#aab6af",
          }}
        >
          <span>Understand. Refine. Mix. Promote.</span>
          <span>Music intelligence.</span>
        </div>
      </div>
    ),
    size,
  );
}
