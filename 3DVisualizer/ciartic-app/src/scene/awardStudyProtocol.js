import { getOperatingRoomSnapshot } from './operatingRoomRuntime.js';
import { getOperatingRoomInteractionSnapshot } from './operatingRoomInteraction.js';
import { getCollisionPlannerSnapshot } from './collisionAwarePlanner.js';
import { getPatientMotionSnapshot } from './patientMotionRuntime.js';
import { getRadiationSnapshot } from './radiationIntelligence.js';
import { logResearchEvent } from './researchRunLogger.js';

const STORAGE_KEY = 'carm_award_study_trials_v1';
const MAX_TRIALS = 5000;
const listeners = new Set();

const safeWindow = () => (typeof window !== 'undefined' ? window : null);

const loadTrials = () => {
  const win = safeWindow();
  if (!win?.localStorage) return [];
  try {
    const parsed = JSON.parse(win.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_TRIALS) : [];
  } catch {
    return [];
  }
};

let trials = loadTrials();

const persist = () => {
  const win = safeWindow();
  if (!win?.localStorage) return;
  try {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(trials.slice(-MAX_TRIALS)));
  } catch {
    // Evidence logging must never interrupt the simulator.
  }
};

const copy = value => {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
};

const numberOrNull = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mean = values => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
};

const median = values => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
};

const percentile = (values, p) => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const index = (finite.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return finite[lo];
  return finite[lo] + (finite[hi] - finite[lo]) * (index - lo);
};

const fnv1a32 = text => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableStringify = value => {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const plannerOutcome = planner => {
  const status = String(planner?.status || 'UNKNOWN').toUpperCase();
  const blocked = status.includes('BLOCKED');
  const rerouted = Boolean(planner?.rerouted) || status.includes('REROUT');
  const directSafe = status.includes('DIRECT_CLEAR') || status.includes('DIRECT_NEAR');
  const directConflict = rerouted || blocked;
  const accepted = directSafe || rerouted;
  return { status, blocked, rerouted, directSafe, directConflict, accepted };
};

const emit = () => {
  const snapshot = getAwardStudySnapshot();
  listeners.forEach(listener => {
    try { listener(snapshot); } catch (error) { console.warn('[award study] subscriber failed', error); }
  });
};

export const getAwardStudyTrials = () => trials.map(copy);

export const getAwardStudySummary = () => {
  const n = trials.length;
  const clearancesMm = trials.map(item => item.collision?.minimum_clearance_mm).filter(Number.isFinite);
  const confidence = trials.map(item => item.geometry?.planner_confidence_pct).filter(Number.isFinite);
  const isoErrors = trials.map(item => item.geometry?.isocenter_error_mm).filter(Number.isFinite);
  const rayErrors = trials.map(item => item.geometry?.central_ray_error_mm).filter(Number.isFinite);
  const planningWaypoints = trials.map(item => item.collision?.checked_waypoints).filter(Number.isFinite);

  const directConflicts = trials.filter(item => item.collision?.direct_route_conflict).length;
  const rerouted = trials.filter(item => item.collision?.rerouted).length;
  const accepted = trials.filter(item => item.collision?.collision_aware_accepted).length;
  const blocked = trials.filter(item => item.collision?.blocked).length;
  const geometryVerified = trials.filter(item => item.geometry?.verified === true).length;
  const metalInFov = trials.filter(item => item.radiation?.metal_in_fov === true).length;

  return {
    schema: 'carm-award-study-summary-v1',
    trials: n,
    direct_route_conflicts: directConflicts,
    direct_route_conflict_rate: n ? directConflicts / n : null,
    rerouted_trials: rerouted,
    reroute_rate: n ? rerouted / n : null,
    collision_aware_accepted: accepted,
    collision_aware_accept_rate: n ? accepted / n : null,
    blocked_trials: blocked,
    blocked_rate: n ? blocked / n : null,
    geometry_verified_trials: geometryVerified,
    geometry_verified_rate: n ? geometryVerified / n : null,
    minimum_clearance_mm: clearancesMm.length ? Math.min(...clearancesMm) : null,
    median_clearance_mm: median(clearancesMm),
    p05_clearance_mm: percentile(clearancesMm, 0.05),
    mean_planner_confidence_pct: mean(confidence),
    mean_isocenter_error_mm: mean(isoErrors),
    mean_central_ray_error_mm: mean(rayErrors),
    median_checked_waypoints: median(planningWaypoints),
    metal_in_fov_trials: metalInFov,
    metal_in_fov_rate: n ? metalInFov / n : null,
  };
};

export const getAwardStudySnapshot = () => ({
  trials: getAwardStudyTrials(),
  summary: getAwardStudySummary(),
});

export const subscribeAwardStudy = listener => {
  listeners.add(listener);
  listener(getAwardStudySnapshot());
  return () => listeners.delete(listener);
};

export const captureAwardStudyTrial = ({
  simulatorContext = {},
  scenario = 'unspecified',
  notes = '',
} = {}) => {
  const orState = getOperatingRoomSnapshot();
  const interaction = getOperatingRoomInteractionSnapshot();
  const planner = getCollisionPlannerSnapshot();
  const motion = getPatientMotionSnapshot();
  const radiation = getRadiationSnapshot();
  const outcome = plannerOutcome(planner);
  const geometryVerification = simulatorContext?.planner?.geometryVerification
    || simulatorContext?.geometry?.verification
    || null;

  const trialBase = {
    schema: 'carm-award-study-trial-v1',
    trial_id: `trial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    scenario: String(scenario || 'unspecified'),
    notes: String(notes || ''),
    simulator: {
      mode: simulatorContext?.mode || 'C-Arm Guidance Simulator V3',
      research_only: true,
      anatomy: simulatorContext?.selection?.anatomyLabel || null,
      projection: simulatorContext?.selection?.projectionLabel || null,
      body_region: simulatorContext?.selection?.bodyRegion || null,
      target: copy(simulatorContext?.planner?.target || simulatorContext?.target || null),
      planner_status_ui: simulatorContext?.planner?.status || null,
    },
    geometry: {
      verified: geometryVerification?.verified === true,
      isocenter_error_mm: numberOrNull(geometryVerification?.isocenter_error_mm),
      central_ray_error_mm: numberOrNull(geometryVerification?.central_ray_error_mm),
      simulator_geometry_tolerance_mm: numberOrNull(simulatorContext?.geometry?.simulatorToleranceMm ?? 1),
      planner_confidence_pct: numberOrNull(simulatorContext?.planner?.confidence?.percentage),
    },
    collision: {
      planner_status: outcome.status,
      direct_route_conflict: outcome.directConflict,
      direct_route_safe: outcome.directSafe,
      rerouted: outcome.rerouted,
      blocked: outcome.blocked,
      collision_aware_accepted: outcome.accepted,
      minimum_clearance_mm: Number.isFinite(planner?.minClearanceM) ? planner.minClearanceM * 1000 : null,
      checked_waypoints: numberOrNull(planner?.checkedWaypoints),
      avoided_obstacles: copy(planner?.avoidedLabels || []),
      live_status: interaction?.liveCollisionStatus || orState?.collisionStatus || null,
      live_minimum_clearance_mm: Number.isFinite(interaction?.liveMinClearanceM)
        ? interaction.liveMinClearanceM * 1000
        : Number.isFinite(orState?.minClearanceM)
          ? orState.minClearanceM * 1000
          : null,
      layout_revision: numberOrNull(interaction?.layoutRevision),
      layout_dirty: Boolean(interaction?.layoutDirty),
      bubbles_visible: Boolean(orState?.bubblesVisible),
    },
    motion: {
      enabled: Boolean(motion?.enabled),
      displacement_mm: Number.isFinite(motion?.displacementM) ? motion.displacementM * 1000 : null,
      amplitude_mm: Number.isFinite(motion?.amplitudeM) ? motion.amplitudeM * 1000 : null,
      breaths_per_minute: numberOrNull(motion?.breathsPerMinute),
      adaptive_status: motion?.adaptiveStatus || null,
      replan_count: numberOrNull(motion?.replanCount),
      robustness: copy(motion?.robustnessResult || null),
    },
    radiation: {
      metal_in_fov: Boolean(radiation?.metalInFov),
      metal_objects: copy(radiation?.metalObjects || []),
      artifact_severity: numberOrNull(radiation?.artifactSeverity),
      output_index: numberOrNull(radiation?.outputIndex),
      kap_proxy_index: numberOrNull(radiation?.kapIndex),
      max_staff_scatter_index: numberOrNull(radiation?.maxStaffScatter),
      kvp: numberOrNull(radiation?.kvp),
      tube_current_ma: numberOrNull(radiation?.tubeCurrentMa),
      pulse_rate_pps: numberOrNull(radiation?.pulseRatePps),
      duration_s: numberOrNull(radiation?.durationS),
      field_size_cm: numberOrNull(radiation?.fieldSizeCm),
    },
    provenance: {
      url: safeWindow()?.location?.href || null,
      user_agent: safeWindow()?.navigator?.userAgent || null,
      thresholds_are_simulator_engineering_limits: true,
      clinical_validation: false,
    },
  };

  const integrity_hash_fnv1a32 = fnv1a32(stableStringify(trialBase));
  const trial = { ...trialBase, integrity_hash_fnv1a32 };
  trials = [...trials, trial].slice(-MAX_TRIALS);
  persist();
  logResearchEvent('award_study_trial_captured', {
    trial_id: trial.trial_id,
    scenario: trial.scenario,
    collision: trial.collision,
    geometry: trial.geometry,
  });
  emit();
  return copy(trial);
};

export const clearAwardStudyTrials = () => {
  trials = [];
  persist();
  logResearchEvent('award_study_trials_cleared');
  emit();
};

const download = (filename, text, type) => {
  const win = safeWindow();
  if (!win?.document) return false;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export const exportAwardStudyJson = () => download(
  `carm-award-study-${stamp()}.json`,
  JSON.stringify({
    schema: 'carm-award-study-package-v1',
    exported_at: new Date().toISOString(),
    methods: {
      design: 'repeated paired simulator trials',
      direct_route_comparator: 'raw planner trajectory classified by the collision-aware scene check',
      collision_method: 'live Three.js scene sampling against explicit safety envelopes',
      geometry_tolerance_mm: 1,
      minimum_collision_clearance_threshold_mm: 5,
      near_clearance_threshold_mm: 80,
      interpretation: 'software-only engineering metrics; not physical or clinical safety validation',
    },
    summary: getAwardStudySummary(),
    trials: getAwardStudyTrials(),
  }, null, 2),
  'application/json',
);

const csvEscape = value => {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export const exportAwardStudyCsv = () => {
  const headers = [
    'trial_id','timestamp','scenario','anatomy','projection','geometry_verified','isocenter_error_mm','central_ray_error_mm','planner_confidence_pct',
    'direct_route_conflict','rerouted','blocked','collision_aware_accepted','minimum_clearance_mm','checked_waypoints','avoided_obstacles',
    'live_minimum_clearance_mm','motion_displacement_mm','replan_count','metal_in_fov','artifact_severity','output_index','kap_proxy_index','integrity_hash_fnv1a32','notes'
  ];
  const rows = trials.map(item => [
    item.trial_id,item.timestamp,item.scenario,item.simulator?.anatomy,item.simulator?.projection,item.geometry?.verified,
    item.geometry?.isocenter_error_mm,item.geometry?.central_ray_error_mm,item.geometry?.planner_confidence_pct,
    item.collision?.direct_route_conflict,item.collision?.rerouted,item.collision?.blocked,item.collision?.collision_aware_accepted,
    item.collision?.minimum_clearance_mm,item.collision?.checked_waypoints,(item.collision?.avoided_obstacles || []).join('|'),
    item.collision?.live_minimum_clearance_mm,item.motion?.displacement_mm,item.motion?.replan_count,item.radiation?.metal_in_fov,
    item.radiation?.artifact_severity,item.radiation?.output_index,item.radiation?.kap_proxy_index,item.integrity_hash_fnv1a32,item.notes,
  ]);
  return download(
    `carm-award-study-${stamp()}.csv`,
    [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n'),
    'text/csv;charset=utf-8',
  );
};

export const exportAwardStudyMarkdown = () => {
  const s = getAwardStudySummary();
  const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const num = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
  const body = `# C-Arm V3 Collision-Aware Digital Twin — Study Snapshot\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `> Software-only research metrics. These results do not establish physical collision safety, clinical accuracy, radiation dose reduction, or medical-device validation.\n\n` +
    `## Methods\n\n- Repeated paired simulator trials.\n- Direct planner trajectory is evaluated against live Three.js safety envelopes.\n- When needed, the collision-aware planner searches staged alternative trajectories.\n- Geometry acceptance is reported separately from collision clearance.\n- Current engineering thresholds: 1 mm simulator geometry criterion, 5 mm minimum sampled collision clearance, 80 mm near-clearance flag.\n\n` +
    `## Current results\n\n` +
    `- Trials: **${s.trials}**\n` +
    `- Direct-route conflict rate: **${pct(s.direct_route_conflict_rate)}**\n` +
    `- Collision-aware accepted rate: **${pct(s.collision_aware_accept_rate)}**\n` +
    `- Reroute rate: **${pct(s.reroute_rate)}**\n` +
    `- Blocked rate: **${pct(s.blocked_rate)}**\n` +
    `- Geometry-verified rate: **${pct(s.geometry_verified_rate)}**\n` +
    `- Median sampled clearance: **${num(s.median_clearance_mm, 1)} mm**\n` +
    `- 5th-percentile sampled clearance: **${num(s.p05_clearance_mm, 1)} mm**\n` +
    `- Minimum sampled clearance: **${num(s.minimum_clearance_mm, 1)} mm**\n` +
    `- Mean planner confidence: **${num(s.mean_planner_confidence_pct, 1)}%**\n` +
    `- Mean isocenter error: **${num(s.mean_isocenter_error_mm, 3)} mm**\n` +
    `- Mean central-ray error: **${num(s.mean_central_ray_error_mm, 3)} mm**\n`;
  return download(`carm-award-study-summary-${stamp()}.md`, body, 'text/markdown;charset=utf-8');
};
