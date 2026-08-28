import React, { useEffect, useState } from 'react';
import App from './App.jsx';
import GeminiAssistant from './components/GeminiAssistant.jsx';
import ResearchControlDock from './components/ResearchControlDock.jsx';
import AwardStudyPanel from './components/AwardStudyPanel.jsx';
import './scene/orDragOverride.js';
import './scene/realisticOperatingRoomAssets.js';
import './scene/orTransformUiCompatibility.js';

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readSimulatorContext = () => {
  const text = document.body?.innerText || '';
  const requestMatch = text.match(/Request:\s*([^\n—]+?)\s*—\s*([^\n]+)/i);
  const regionMatch = text.match(/Region:\s*([^\n]+)/i);
  const statusMatch = text.match(/Status:\s*([^\n]+)/i);
  const confidenceMatch = text.match(/Confidence:\s*([\d.]+)%/i);
  const targetMatch = text.match(/Target:\s*\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)\s*mm/i);
  const isoMatch = text.match(/Isocenter error:\s*([\d.]+)\s*mm/i);
  const rayMatch = text.match(/Central-ray error:\s*([\d.]+)\s*mm/i);
  const finalOrbitalMatch = text.match(/Final orbital:\s*([-\d.]+)°/i);
  const finalLiftMatch = text.match(/Final lift:\s*([-\d.]+)/i);
  const finalWigWagMatch = text.match(/Final wig-wag:\s*([-\d.]+)°/i);
  const finalCartXMatch = text.match(/Final cart X:\s*([-\d.]+)/i);
  const finalCartZMatch = text.match(/Final cart Z:\s*([-\d.]+)/i);
  const geometryVerified = /SCENE GEOMETRY VERIFIED/i.test(text);
  const arrived = /Status:\s*ARRIVED/i.test(text);
  const exposing = /EXPOSING…|EXPOSING\.\.\./i.test(text);
  const projectionLabel = requestMatch?.[2]?.trim() || null;
  const anatomyLabel = requestMatch?.[1]?.trim() || null;

  return {
    mode: 'C-Arm Guidance Simulator V3',
    researchOnly: true,
    selection: {
      anatomyLabel,
      anatomyShortLabel: anatomyLabel,
      projectionLabel,
      bodyRegion: regionMatch?.[1]?.trim() || null,
    },
    beam: { active: exposing },
    exposure: { status: exposing ? 'EXPOSING' : arrived ? 'READY' : null },
    planner: {
      status: statusMatch?.[1]?.trim() || null,
      view: projectionLabel,
      target: targetMatch ? {
        x_mm: parseNumber(targetMatch[1]),
        y_mm: parseNumber(targetMatch[2]),
        z_mm: parseNumber(targetMatch[3]),
      } : null,
      confidence: confidenceMatch ? { percentage: parseNumber(confidenceMatch[1]) } : null,
      geometryVerification: geometryVerified ? {
        verified: true,
        isocenter_error_mm: isoMatch ? parseNumber(isoMatch[1]) : null,
        central_ray_error_mm: rayMatch ? parseNumber(rayMatch[1]) : null,
      } : null,
      finalPose: finalOrbitalMatch || finalLiftMatch || finalWigWagMatch || finalCartXMatch || finalCartZMatch ? {
        orbital_slide_deg: finalOrbitalMatch ? parseNumber(finalOrbitalMatch[1]) : null,
        lift: finalLiftMatch ? parseNumber(finalLiftMatch[1]) : null,
        wig_wag_deg: finalWigWagMatch ? parseNumber(finalWigWagMatch[1]) : null,
        cart_x: finalCartXMatch ? parseNumber(finalCartXMatch[1]) : null,
        cart_z: finalCartZMatch ? parseNumber(finalCartZMatch[1]) : null,
      } : null,
      hasPlannedPath: /MOVE C-ARM/i.test(text),
      isPlanning: /PLANNING|SOLVING/i.test(text),
      isPathAnimating: /MOVING|ANIMATING/i.test(text),
    },
    target: targetMatch ? {
      x_mm: parseNumber(targetMatch[1]),
      y_mm: parseNumber(targetMatch[2]),
      z_mm: parseNumber(targetMatch[3]),
    } : null,
    geometry: {
      verification: geometryVerified ? {
        verified: true,
        isocenter_error_mm: isoMatch ? parseNumber(isoMatch[1]) : null,
        central_ray_error_mm: rayMatch ? parseNumber(rayMatch[1]) : null,
      } : null,
      simulatorToleranceMm: 1,
    },
  };
};

export default function SimulatorShell() {
  const [simulatorContext, setSimulatorContext] = useState(() => ({
    mode: 'C-Arm Guidance Simulator V3',
    researchOnly: true,
  }));

  useEffect(() => {
    const refresh = () => setSimulatorContext(readSimulatorContext());
    refresh();
    const timer = window.setInterval(refresh, 750);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <App />
      <ResearchControlDock />
      <AwardStudyPanel simulatorContext={simulatorContext} />
      <GeminiAssistant simulatorContext={simulatorContext} />
    </>
  );
}
