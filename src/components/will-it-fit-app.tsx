"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { jsPDF } from "jspdf";
import Konva from "konva";
import {
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileDown,
  Hand,
  Home,
  Lock,
  MousePointer2,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const STORAGE_KEY = "will-it-fit-layout-v1";
const DEFAULT_PIXELS_PER_FOOT = 28;
const MIN_FURNITURE_FEET = 0.5;

type ToolMode = "move" | "pan" | "calibrate";

type PlanImage = {
  src: string;
  width: number;
  height: number;
  fileName: string;
  type: string;
};

type CalibrationLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type Point = {
  x: number;
  y: number;
};

type PinchGesture = {
  startDistance: number;
  startScale: number;
  worldCenter: Point;
};

type Calibration = {
  pixelsPerFoot: number | null;
  realLengthFt: number | null;
  line: CalibrationLine | null;
};

type FurnitureTemplate = {
  id: string;
  name: string;
  widthFt: number;
  depthFt: number;
  color: string;
  accent: string;
};

type FurnitureItem = {
  id: string;
  name: string;
  widthFt: number;
  depthFt: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
  accent: string;
};

type SavedLayout = {
  plan: PlanImage | null;
  calibration: Calibration;
  furniture: FurnitureItem[];
};

type PdfPageProxy = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfDocumentProxy = {
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: { data: ArrayBuffer }) => {
    promise: Promise<PdfDocumentProxy>;
  };
};

const FURNITURE_LIBRARY: FurnitureTemplate[] = [
  {
    id: "twin-bed",
    name: "Twin bed",
    widthFt: 39 / 12,
    depthFt: 75 / 12,
    color: "#d9e6ed",
    accent: "#2f6073",
  },
  {
    id: "full-bed",
    name: "Full bed",
    widthFt: 54 / 12,
    depthFt: 75 / 12,
    color: "#e8dfc6",
    accent: "#8b7641",
  },
  {
    id: "queen-bed",
    name: "Queen bed",
    widthFt: 60 / 12,
    depthFt: 80 / 12,
    color: "#e4e0ef",
    accent: "#635485",
  },
  {
    id: "king-bed",
    name: "King bed",
    widthFt: 76 / 12,
    depthFt: 80 / 12,
    color: "#dce9dc",
    accent: "#627a52",
  },
  {
    id: "crib",
    name: "Crib",
    widthFt: 28 / 12,
    depthFt: 54 / 12,
    color: "#f2ddc9",
    accent: "#ad6c3e",
  },
  {
    id: "sofa",
    name: "Sofa",
    widthFt: 7,
    depthFt: 3,
    color: "#d8e7e4",
    accent: "#2c6a65",
  },
  {
    id: "sectional",
    name: "Sectional",
    widthFt: 9,
    depthFt: 6,
    color: "#e9dccf",
    accent: "#9f563d",
  },
  {
    id: "dining-table",
    name: "Dining table",
    widthFt: 6,
    depthFt: 3.5,
    color: "#efe4bd",
    accent: "#9c7d2f",
  },
  {
    id: "desk",
    name: "Desk",
    widthFt: 4,
    depthFt: 2,
    color: "#dde6f2",
    accent: "#315f94",
  },
  {
    id: "dresser",
    name: "Dresser",
    widthFt: 5,
    depthFt: 20 / 12,
    color: "#ead9d1",
    accent: "#9d4a3b",
  },
  {
    id: "nightstand",
    name: "Nightstand",
    widthFt: 2,
    depthFt: 20 / 12,
    color: "#e8efd5",
    accent: "#6f7d38",
  },
  {
    id: "coffee-table",
    name: "Coffee table",
    widthFt: 4,
    depthFt: 2,
    color: "#f0dcc2",
    accent: "#9b6737",
  },
];

const initialCalibration: Calibration = {
  pixelsPerFoot: null,
  realLengthFt: null,
  line: null,
};

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function feetFromParts(feet: string, inches: string) {
  const footValue = Number.parseFloat(feet) || 0;
  const inchValue = Number.parseFloat(inches) || 0;
  return Math.max(0, footValue + inchValue / 12);
}

function formatFeet(value: number) {
  const totalInches = Math.round(value * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.abs(totalInches % 12);

  if (feet === 0) {
    return `${inches}"`;
  }

  if (inches === 0) {
    return `${feet}'`;
  }

  return `${feet}'${inches}"`;
}

function formatDims(widthFt: number, depthFt: number) {
  return `${formatFeet(widthFt)} x ${formatFeet(depthFt)}`;
}

function distance(line: CalibrationLine) {
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
}

function pointDistance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: Point, second: Point) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function getItemPixels(item: FurnitureItem, pixelsPerFoot: number) {
  return {
    width: item.widthFt * pixelsPerFoot,
    depth: item.depthFt * pixelsPerFoot,
  };
}

function getFurnitureCorners(item: FurnitureItem, pixelsPerFoot: number) {
  const { width, depth } = getItemPixels(item, pixelsPerFoot);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const radians = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const localCorners = [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ];

  return localCorners.map((point) => ({
    x: item.x + point.x * cos - point.y * sin,
    y: item.y + point.x * sin + point.y * cos,
  }));
}

function polygonsOverlap(
  a: ReturnType<typeof getFurnitureCorners>,
  b: ReturnType<typeof getFurnitureCorners>,
) {
  const polygons = [a, b];

  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const nextIndex = (index + 1) % polygon.length;
      const edge = {
        x: polygon[nextIndex].x - polygon[index].x,
        y: polygon[nextIndex].y - polygon[index].y,
      };
      const axis = { x: -edge.y, y: edge.x };
      const axisLength = Math.hypot(axis.x, axis.y) || 1;
      const normalized = {
        x: axis.x / axisLength,
        y: axis.y / axisLength,
      };
      const projectionA = projectPolygon(a, normalized);
      const projectionB = projectPolygon(b, normalized);

      if (projectionA.max < projectionB.min || projectionB.max < projectionA.min) {
        return false;
      }
    }
  }

  return true;
}

function projectPolygon(
  polygon: ReturnType<typeof getFurnitureCorners>,
  axis: { x: number; y: number },
) {
  let min = Infinity;
  let max = -Infinity;

  for (const point of polygon) {
    const projection = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  return { min, max };
}

function safeNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function getReadableFileName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function makeSamplePlan(): PlanImage {
  const width = 1320;
  const height = 900;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return {
      src: "",
      width,
      height,
      fileName: "sample-floor-plan.png",
      type: "image/png",
    };
  }

  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(34, 58, 84, 0.13)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= width; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y <= height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#223a54";
  ctx.lineWidth = 16;
  ctx.strokeRect(88, 92, 1120, 680);
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(620, 92);
  ctx.lineTo(620, 772);
  ctx.moveTo(88, 420);
  ctx.lineTo(620, 420);
  ctx.moveTo(620, 520);
  ctx.lineTo(1208, 520);
  ctx.moveTo(915, 520);
  ctx.lineTo(915, 772);
  ctx.stroke();

  ctx.strokeStyle = "#f7f2e8";
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(420, 420);
  ctx.lineTo(500, 420);
  ctx.moveTo(620, 300);
  ctx.lineTo(620, 378);
  ctx.moveTo(850, 520);
  ctx.lineTo(910, 520);
  ctx.moveTo(1044, 772);
  ctx.lineTo(1135, 772);
  ctx.stroke();

  ctx.strokeStyle = "#c34d36";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(500, 420, 80, Math.PI, Math.PI * 1.5);
  ctx.arc(620, 378, 78, Math.PI / 2, Math.PI);
  ctx.stroke();

  ctx.fillStyle = "rgba(47, 96, 115, 0.11)";
  ctx.fillRect(102, 106, 504, 300);
  ctx.fillRect(634, 106, 560, 394);
  ctx.fillRect(102, 434, 504, 324);
  ctx.fillRect(634, 534, 266, 224);
  ctx.fillRect(930, 534, 264, 224);

  ctx.fillStyle = "#223a54";
  ctx.font = "600 24px system-ui, sans-serif";
  ctx.fillText("Living", 132, 142);
  ctx.fillText("Bedroom", 664, 142);
  ctx.fillText("Kitchen", 132, 470);
  ctx.fillText("Bath", 662, 570);
  ctx.fillText("Entry", 958, 570);

  ctx.strokeStyle = "#1e2725";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(150, 820);
  ctx.lineTo(486, 820);
  ctx.stroke();
  ctx.fillStyle = "#1e2725";
  ctx.font = "500 18px system-ui, sans-serif";
  ctx.fillText("Sample 12 ft wall for calibration", 150, 850);

  return {
    src: canvas.toDataURL("image/png"),
    width,
    height,
    fileName: "sample-floor-plan.png",
    type: "image/png",
  };
}

function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let nextText = text;
  while (nextText.length > 4 && ctx.measureText(`${nextText}...`).width > maxWidth) {
    nextText = nextText.slice(0, -1);
  }

  return `${nextText}...`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

export function WillItFitApp() {
  const [plan, setPlan] = useState<PlanImage | null>(null);
  const [backgroundImage, setBackgroundImage] =
    useState<HTMLImageElement | null>(null);
  const [calibration, setCalibration] =
    useState<Calibration>(initialCalibration);
  const [furniture, setFurniture] = useState<FurnitureItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>("move");
  const [stageSize, setStageSize] = useState({ width: 900, height: 620 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 80, y: 80 });
  const [draftLine, setDraftLine] = useState<CalibrationLine | null>(null);
  const [knownFeet, setKnownFeet] = useState("12");
  const [knownInches, setKnownInches] = useState("0");
  const [customName, setCustomName] = useState("Bookcase");
  const [customWidthFeet, setCustomWidthFeet] = useState("3");
  const [customWidthInches, setCustomWidthInches] = useState("0");
  const [customDepthFeet, setCustomDepthFeet] = useState("1");
  const [customDepthInches, setCustomDepthInches] = useState("0");
  const [status, setStatus] = useState("Autosaved locally");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shouldFitPlan, setShouldFitPlan] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Record<string, Konva.Group | null>>({});
  const calibrationStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const interactionRef = useRef(false);

  const pixelsPerFoot = calibration.pixelsPerFoot ?? DEFAULT_PIXELS_PER_FOOT;
  const isCalibrated = calibration.pixelsPerFoot !== null;
  const selectedItem = useMemo(
    () => furniture.find((item) => item.id === selectedId) ?? null,
    [furniture, selectedId],
  );

  const overlapIds = useMemo(() => {
    const ids = new Set<string>();

    for (let first = 0; first < furniture.length; first += 1) {
      for (let second = first + 1; second < furniture.length; second += 1) {
        const itemA = furniture[first];
        const itemB = furniture[second];
        const cornersA = getFurnitureCorners(itemA, pixelsPerFoot);
        const cornersB = getFurnitureCorners(itemB, pixelsPerFoot);

        if (polygonsOverlap(cornersA, cornersB)) {
          ids.add(itemA.id);
          ids.add(itemB.id);
        }
      }
    }

    return ids;
  }, [furniture, pixelsPerFoot]);

  const fitToPlan = useCallback(() => {
    if (!plan) {
      setStageScale(1);
      setStagePosition({ x: 80, y: 80 });
      return;
    }

    const gutter = 64;
    const nextScale = clamp(
      Math.min(
        (stageSize.width - gutter) / plan.width,
        (stageSize.height - gutter) / plan.height,
      ),
      0.12,
      2.25,
    );

    setStageScale(nextScale);
    setStagePosition({
      x: (stageSize.width - plan.width * nextScale) / 2,
      y: (stageSize.height - plan.height * nextScale) / 2,
    });
  }, [plan, stageSize.height, stageSize.width]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);

      if (saved) {
        try {
          const parsed = JSON.parse(saved) as SavedLayout;
          setPlan(parsed.plan ?? null);
          setCalibration(parsed.calibration ?? initialCalibration);
          setFurniture(parsed.furniture ?? []);
          setStatus("Restored local layout");
        } catch {
          setStatus("Started a fresh layout");
        }
      }

      setHasHydrated(true);
    }, 0);

    return () => {
      window.clearTimeout(restoreTimer);
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      const payload: SavedLayout = { plan, calibration, furniture };

      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        setStatus("Local save is full. Export before refreshing.");
      }
    }, interactionRef.current ? 900 : 350);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [calibration, furniture, hasHydrated, plan]);

  useEffect(() => {
    if (!plan?.src) {
      return;
    }

    let isCurrent = true;
    const image = new window.Image();
    image.onload = () => {
      if (isCurrent) {
        setBackgroundImage(image);
      }
    };
    image.src = plan.src;

    return () => {
      isCurrent = false;
    };
  }, [plan?.src]);

  useEffect(() => {
    const shell = canvasShellRef.current;

    if (!shell) {
      return;
    }

    const measure = () => {
      const rect = shell.getBoundingClientRect();
      setStageSize({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(420, Math.floor(rect.height)),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!shouldFitPlan || !plan) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitToPlan();
      setShouldFitPlan(false);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [fitToPlan, plan, shouldFitPlan, stageSize]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const selectedNode = selectedId ? itemRefs.current[selectedId] : null;

    if (!transformer) {
      return;
    }

    if (selectedNode) {
      transformer.nodes([selectedNode]);
    } else {
      transformer.nodes([]);
    }

    transformer.getLayer()?.batchDraw();
  }, [furniture, selectedId]);

  const getWorldPointer = useCallback(() => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();

    if (!stage || !pointer) {
      return null;
    }

    return {
      x: (pointer.x - stage.x()) / stage.scaleX(),
      y: (pointer.y - stage.y()) / stage.scaleY(),
    };
  }, []);

  const getTouchPair = (event: TouchEvent) => {
    const stage = stageRef.current;
    const rect = stage?.container().getBoundingClientRect();

    if (!stage || !rect || event.touches.length < 2) {
      return null;
    }

    const first = event.touches[0];
    const second = event.touches[1];

    return {
      first: {
        x: first.clientX - rect.left,
        y: first.clientY - rect.top,
      },
      second: {
        x: second.clientX - rect.left,
        y: second.clientY - rect.top,
      },
    };
  };

  const startPinch = (event: TouchEvent) => {
    const pair = getTouchPair(event);
    const stage = stageRef.current;

    if (!pair || !stage) {
      return;
    }

    const center = midpoint(pair.first, pair.second);
    const startScale = stage.scaleX();
    stage.stopDrag();
    calibrationStartRef.current = null;
    setDraftLine(null);
    interactionRef.current = true;
    pinchGestureRef.current = {
      startDistance: pointDistance(pair.first, pair.second),
      startScale,
      worldCenter: {
        x: (center.x - stage.x()) / startScale,
        y: (center.y - stage.y()) / startScale,
      },
    };
  };

  const updatePinch = (event: TouchEvent) => {
    const gesture = pinchGestureRef.current;
    const pair = getTouchPair(event);

    if (!gesture || !pair) {
      return;
    }

    const center = midpoint(pair.first, pair.second);
    const nextScale = clamp(
      gesture.startScale *
        (pointDistance(pair.first, pair.second) / gesture.startDistance),
      0.08,
      5,
    );

    setStageScale(nextScale);
    setStagePosition({
      x: center.x - gesture.worldCenter.x * nextScale,
      y: center.y - gesture.worldCenter.y * nextScale,
    });
  };

  const addFurniture = useCallback(
    (template: FurnitureTemplate, position?: { x: number; y: number }) => {
      const fallback = {
        x: (stageSize.width / 2 - stagePosition.x) / stageScale,
        y: (stageSize.height / 2 - stagePosition.y) / stageScale,
      };
      const nextItem: FurnitureItem = {
        id: createId(template.id),
        name: template.name,
        widthFt: template.widthFt,
        depthFt: template.depthFt,
        x: position?.x ?? fallback.x,
        y: position?.y ?? fallback.y,
        rotation: 0,
        color: template.color,
        accent: template.accent,
      };

      setFurniture((items) => [...items, nextItem]);
      setSelectedId(nextItem.id);
      setTool("move");
    },
    [stagePosition.x, stagePosition.y, stageScale, stageSize.height, stageSize.width],
  );

  const updateSelected = useCallback(
    (updates: Partial<FurnitureItem>) => {
      if (!selectedId) {
        return;
      }

      setFurniture((items) =>
        items.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                ...updates,
                widthFt: Math.max(
                  MIN_FURNITURE_FEET,
                  safeNumber(updates.widthFt ?? item.widthFt, item.widthFt),
                ),
                depthFt: Math.max(
                  MIN_FURNITURE_FEET,
                  safeNumber(updates.depthFt ?? item.depthFt, item.depthFt),
                ),
              }
            : item,
        ),
      );
    },
    [selectedId],
  );

  const rotateSelected = (degrees: number) => {
    if (!selectedId) {
      return;
    }

    setFurniture((items) =>
      items.map((item) =>
        item.id === selectedId
          ? { ...item, rotation: (item.rotation + degrees + 360) % 360 }
          : item,
      ),
    );
  };

  const duplicateSelected = () => {
    if (!selectedItem) {
      return;
    }

    const copyItem: FurnitureItem = {
      ...selectedItem,
      id: createId("copy"),
      x: selectedItem.x + 18 / stageScale,
      y: selectedItem.y + 18 / stageScale,
      name: `${selectedItem.name} copy`,
    };

    setFurniture((items) => [...items, copyItem]);
    setSelectedId(copyItem.id);
  };

  const deleteSelected = () => {
    if (!selectedId) {
      return;
    }

    setFurniture((items) => items.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        if (selectedId) {
          event.preventDefault();
          deleteSelected();
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        if (selectedId) {
          event.preventDefault();
          duplicateSelected();
        }
      }

      if (event.key.toLowerCase() === "r" && selectedId) {
        event.preventDefault();
        rotateSelected(15);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  const readImageFile = useCallback(async (file: File) => {
    const result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = result;
    });

    return {
      src: result,
      width: image.naturalWidth,
      height: image.naturalHeight,
      fileName: file.name,
      type: file.type,
    };
  }, []);

  const readPdfFile = useCallback(async (file: File) => {
    const pdfjs = (await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    )) as unknown as PdfJsModule;
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const data = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Could not prepare PDF preview");
    }

    await page.render({ canvasContext: ctx, viewport }).promise;

    return {
      src: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      fileName: `${getReadableFileName(file.name)}.png`,
      type: "image/png",
    };
  }, []);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }

      setUploadError(null);
      setStatus("Loading floor plan...");

      try {
        const nextPlan =
          file.type === "application/pdf"
            ? await readPdfFile(file)
            : await readImageFile(file);

        setPlan(nextPlan);
        setBackgroundImage(null);
        setSelectedId(null);
        setShouldFitPlan(true);
        setStatus("Floor plan ready");
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : "Could not load that file",
        );
        setStatus("Upload failed");
      }
    },
    [readImageFile, readPdfFile],
  );

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDropFile = (event: DragEvent<HTMLDivElement>) => {
    const templateId = event.dataTransfer.getData("application/will-it-fit");

    if (templateId) {
      return;
    }

    event.preventDefault();
    void handleFile(event.dataTransfer.files?.[0]);
  };

  const handleTemplateDragStart = (
    event: DragEvent<HTMLButtonElement>,
    templateId: string,
  ) => {
    event.dataTransfer.setData("application/will-it-fit", templateId);
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const templateId = event.dataTransfer.getData("application/will-it-fit");

    if (!templateId) {
      void handleFile(event.dataTransfer.files?.[0]);
      return;
    }

    const template = FURNITURE_LIBRARY.find((item) => item.id === templateId);
    const stage = stageRef.current;
    const rect = stage?.container().getBoundingClientRect();

    if (!template || !stage || !rect) {
      return;
    }

    const position = {
      x: (event.clientX - rect.left - stage.x()) / stage.scaleX(),
      y: (event.clientY - rect.top - stage.y()) / stage.scaleY(),
    };

    addFurniture(template, position);
  };

  const handleStageMouseDown = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if ("touches" in event.evt) {
      event.evt.preventDefault();

      if (event.evt.touches.length >= 2) {
        startPinch(event.evt);
        return;
      }
    }

    if (pinchGestureRef.current) {
      return;
    }

    const point = getWorldPointer();

    if (tool === "calibrate" && point) {
      calibrationStartRef.current = point;
      setDraftLine({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      setSelectedId(null);
      return;
    }

    const stage = event.target.getStage();
    const clickedEmpty =
      event.target === stage ||
      event.target.name() === "floor-plan" ||
      event.target.name() === "canvas-paper";

    if (clickedEmpty) {
      setSelectedId(null);
    }
  };

  const handleStageMouseMove = (
    event?: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if (event && "touches" in event.evt) {
      event.evt.preventDefault();

      if (event.evt.touches.length >= 2) {
        if (!pinchGestureRef.current) {
          startPinch(event.evt);
        }
        updatePinch(event.evt);
        return;
      }
    }

    if (pinchGestureRef.current) {
      return;
    }

    if (tool !== "calibrate" || !calibrationStartRef.current) {
      return;
    }

    const point = getWorldPointer();

    if (!point) {
      return;
    }

    setDraftLine({
      x1: calibrationStartRef.current.x,
      y1: calibrationStartRef.current.y,
      x2: point.x,
      y2: point.y,
    });
  };

  const handleStageMouseUp = (
    event?: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if (event && "touches" in event.evt) {
      event.evt.preventDefault();

      if (pinchGestureRef.current) {
        if (event.evt.touches.length < 2) {
          pinchGestureRef.current = null;
          interactionRef.current = false;
        }
        return;
      }
    }

    if (tool !== "calibrate" || !draftLine || !calibrationStartRef.current) {
      calibrationStartRef.current = null;
      return;
    }

    if (distance(draftLine) > 8) {
      setCalibration((current) => ({
        ...current,
        line: draftLine,
      }));
    }

    calibrationStartRef.current = null;
  };

  const applyCalibration = () => {
    const line = calibration.line ?? draftLine;
    const realLength = feetFromParts(knownFeet, knownInches);

    if (!line || realLength <= 0) {
      setStatus("Draw a line and enter its real length");
      return;
    }

    const measuredPixels = distance(line);

    if (measuredPixels < 8) {
      setStatus("Calibration line is too short");
      return;
    }

    setCalibration({
      line,
      realLengthFt: realLength,
      pixelsPerFoot: measuredPixels / realLength,
    });
    setDraftLine(null);
    setTool("move");
    setStatus(`Scale set: 1 ft = ${(measuredPixels / realLength).toFixed(1)} px`);
  };

  const addCustomFurniture = () => {
    const widthFt = feetFromParts(customWidthFeet, customWidthInches);
    const depthFt = feetFromParts(customDepthFeet, customDepthInches);

    if (!customName.trim() || widthFt <= 0 || depthFt <= 0) {
      setStatus("Custom item needs a name, width, and depth");
      return;
    }

    addFurniture({
      id: "custom",
      name: customName.trim(),
      widthFt,
      depthFt,
      color: "#f0dcc2",
      accent: "#c34d36",
    });
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();

    if (!stage || !pointer) {
      return;
    }

    const oldScale = stage.scaleX();
    const zoomFactor = event.evt.deltaY > 0 ? 0.92 : 1.08;
    const nextScale = clamp(oldScale * zoomFactor, 0.08, 5);
    const mousePoint = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    setStageScale(nextScale);
    setStagePosition({
      x: pointer.x - mousePoint.x * nextScale,
      y: pointer.y - mousePoint.y * nextScale,
    });
  };

  const zoomBy = (factor: number) => {
    const nextScale = clamp(stageScale * factor, 0.08, 5);
    const center = {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    };
    const worldCenter = {
      x: (center.x - stagePosition.x) / stageScale,
      y: (center.y - stagePosition.y) / stageScale,
    };

    setStageScale(nextScale);
    setStagePosition({
      x: center.x - worldCenter.x * nextScale,
      y: center.y - worldCenter.y * nextScale,
    });
  };

  const useSamplePlan = () => {
    const sample = makeSamplePlan();
    setPlan(sample);
    setCalibration(initialCalibration);
    setFurniture([]);
    setSelectedId(null);
    setShouldFitPlan(true);
    setStatus("Sample floor plan loaded");
  };

  const resetLayout = () => {
    const confirmed = window.confirm("Clear this local layout?");

    if (!confirmed) {
      return;
    }

    setPlan(null);
    setBackgroundImage(null);
    setCalibration(initialCalibration);
    setFurniture([]);
    setSelectedId(null);
    setDraftLine(null);
    setStageScale(1);
    setStagePosition({ x: 80, y: 80 });
    window.localStorage.removeItem(STORAGE_KEY);
    setStatus("Layout cleared");
  };

  const renderLayoutCanvas = useCallback(() => {
    const baseWidth = plan?.width ?? 1400;
    const baseHeight = plan?.height ?? 900;
    const maxExportEdge = 3600;
    const exportScale = Math.min(2, maxExportEdge / Math.max(baseWidth, baseHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(baseWidth * exportScale));
    canvas.height = Math.max(1, Math.round(baseHeight * exportScale));
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Could not prepare export");
    }

    ctx.scale(exportScale, exportScale);
    ctx.fillStyle = "#f7f2e8";
    ctx.fillRect(0, 0, baseWidth, baseHeight);

    if (backgroundImage && plan) {
      ctx.drawImage(backgroundImage, 0, 0, plan.width, plan.height);
    } else {
      ctx.strokeStyle = "rgba(34, 58, 84, 0.16)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= baseWidth; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, baseHeight);
        ctx.stroke();
      }
      for (let y = 0; y <= baseHeight; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(baseWidth, y);
        ctx.stroke();
      }
    }

    if (calibration.line) {
      ctx.save();
      ctx.strokeStyle = "#c34d36";
      ctx.lineWidth = 4;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(calibration.line.x1, calibration.line.y1);
      ctx.lineTo(calibration.line.x2, calibration.line.y2);
      ctx.stroke();
      ctx.restore();
    }

    for (const item of furniture) {
      const { width, depth } = getItemPixels(item, pixelsPerFoot);
      const isOverlapping = overlapIds.has(item.id);

      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate((item.rotation * Math.PI) / 180);
      drawRoundedRect(ctx, -width / 2, -depth / 2, width, depth, 8);
      ctx.fillStyle = item.color;
      ctx.strokeStyle = isOverlapping ? "#c34d36" : item.accent;
      ctx.lineWidth = isOverlapping ? 6 : 3;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#1e2725";
      const fontSize = clamp(Math.min(width, depth) / 5, 11, 22);
      ctx.font = `700 ${fontSize}px Geist, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = fitCanvasText(ctx, item.name, width - 18);
      ctx.fillText(label, 0, -fontSize * 0.35);
      ctx.font = `600 ${Math.max(10, fontSize * 0.72)}px Geist Mono, monospace`;
      ctx.fillText(formatDims(item.widthFt, item.depthFt), 0, fontSize * 0.95);
      ctx.restore();
    }

    return canvas;
  }, [
    backgroundImage,
    calibration.line,
    furniture,
    overlapIds,
    pixelsPerFoot,
    plan,
  ]);

  const exportPng = () => {
    try {
      const canvas = renderLayoutCanvas();
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "will-it-fit-layout.png";
      link.click();
      setStatus("PNG exported");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    }
  };

  const exportPdf = () => {
    try {
      const canvas = renderLayoutCanvas();
      const dataUrl = canvas.toDataURL("image/png");
      const orientation = canvas.width > canvas.height ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "pt", format: "letter" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const imageWidth = canvas.width * scale;
      const imageHeight = canvas.height * scale;
      const x = (pageWidth - imageWidth) / 2;
      const y = (pageHeight - imageHeight) / 2;
      pdf.addImage(dataUrl, "PNG", x, y, imageWidth, imageHeight);
      pdf.save("will-it-fit-layout.pdf");
      setStatus("PDF exported");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDF export failed");
    }
  };

  const exportJson = () => {
    const payload: SavedLayout = { plan, calibration, furniture };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "will-it-fit-layout.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Layout JSON exported");
  };

  const stageBackgroundWidth = plan?.width ?? 1400;
  const stageBackgroundHeight = plan?.height ?? 900;
  const calibrationLine = draftLine ?? calibration.line;
  const calibrationLength = calibrationLine ? distance(calibrationLine) : 0;

  return (
    <main className="min-h-[100svh] px-4 py-4 text-[#1e2725] sm:px-5 lg:px-6">
      <header className="mx-auto mb-4 flex max-w-[1800px] flex-col gap-4 rounded-[8px] border border-[#1e2725]/10 bg-[#fbf7ee]/80 px-4 py-4 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-blueprint text-4xl leading-none tracking-normal text-[#223a54] sm:text-5xl">
              Will It Fit?
            </h1>
            <span className="rounded-full border border-[#c34d36]/30 bg-[#fff8ed] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#9b3f2b]">
              NYC move-in canvas
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm font-medium text-[#43514e] sm:text-base">
            Upload a floor plan. Add your furniture. Know what fits.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 text-sm font-semibold text-[#223a54] shadow-sm transition hover:bg-[#f6efe3]"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Upload size={16} />
            Upload
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 text-sm font-semibold text-[#223a54] shadow-sm transition hover:bg-[#f6efe3]"
            onClick={exportPng}
            type="button"
          >
            <Download size={16} />
            PNG
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 text-sm font-semibold text-[#223a54] shadow-sm transition hover:bg-[#f6efe3]"
            onClick={exportPdf}
            type="button"
          >
            <FileDown size={16} />
            PDF
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[#c34d36]/25 bg-[#fff4ed] px-3 text-sm font-semibold text-[#9b3f2b] shadow-sm transition hover:bg-[#ffe8db]"
            onClick={resetLayout}
            type="button"
          >
            <RefreshCw size={16} />
            Reset
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        accept="image/png,image/jpeg,application/pdf"
        className="hidden"
        onChange={handleFileInput}
        type="file"
      />

      <section className="mx-auto grid max-w-[1800px] gap-4 lg:grid-cols-[310px_minmax(0,1fr)_310px]">
        <aside className="paper-panel order-2 max-h-[calc(100svh-136px)] overflow-auto rounded-[8px] p-4 lg:order-1">
          <PanelTitle icon={<Upload size={17} />} title="Floor plan" />
          <div
            className="mt-3 rounded-[8px] border border-dashed border-[#223a54]/30 bg-white/60 p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropFile}
          >
            <button
              className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#223a54] px-3 py-3 text-sm font-semibold text-white transition hover:bg-[#2f6073]"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <Upload size={16} />
              Upload PNG, JPG, or PDF
            </button>
            <button
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-[#fbf7ee] px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f4ead9]"
              onClick={useSamplePlan}
              type="button"
            >
              <Home size={16} />
              Try sample plan
            </button>
            {plan ? (
              <div className="mt-3 rounded-[6px] bg-[#f7efe2] p-3 text-xs text-[#4b5653]">
                <div className="flex items-center gap-2 font-semibold text-[#1e2725]">
                  <Lock size={14} />
                  {plan.fileName}
                </div>
                <div className="mt-1 font-mono">
                  {plan.width} x {plan.height}px locked background
                </div>
              </div>
            ) : null}
            {uploadError ? (
              <p className="mt-3 text-sm font-semibold text-[#c34d36]">
                {uploadError}
              </p>
            ) : null}
          </div>

          <div className="mt-5">
            <PanelTitle icon={<Ruler size={17} />} title="Calibrate scale" />
            <div className="mt-3 space-y-3 rounded-[8px] border border-[#223a54]/10 bg-white/65 p-3">
              <button
                className={`flex w-full items-center justify-center gap-2 rounded-[6px] px-3 py-2.5 text-sm font-semibold transition ${
                  tool === "calibrate"
                    ? "bg-[#c34d36] text-white"
                    : "bg-[#223a54] text-white hover:bg-[#2f6073]"
                }`}
                onClick={() => setTool("calibrate")}
                type="button"
              >
                <Ruler size={16} />
                Draw known distance
              </button>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Feet"
                  onChange={setKnownFeet}
                  value={knownFeet}
                />
                <NumberField
                  label="Inches"
                  onChange={setKnownInches}
                  value={knownInches}
                />
              </div>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-[6px] border border-[#c34d36]/25 bg-[#fff4ed] px-3 py-2.5 text-sm font-semibold text-[#9b3f2b] transition hover:bg-[#ffe8db]"
                onClick={applyCalibration}
                type="button"
              >
                <Check size={16} />
                Apply scale
              </button>
              <div className="rounded-[6px] bg-[#f7efe2] p-3 text-xs text-[#4b5653]">
                {isCalibrated ? (
                  <>
                    <div className="font-semibold text-[#1e2725]">
                      1 ft = {pixelsPerFoot.toFixed(1)} px
                    </div>
                    <div>
                      Known line: {formatFeet(calibration.realLengthFt ?? 0)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold text-[#1e2725]">
                      Draft scale active
                    </div>
                    <div>
                      {calibrationLength > 0
                        ? `${Math.round(calibrationLength)} px line drawn`
                        : "Draw across a known wall or doorway."}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <PanelTitle icon={<Plus size={17} />} title="Furniture library" />
            <div className="mt-3 grid gap-2">
              {FURNITURE_LIBRARY.map((template) => (
                <button
                  className="group flex cursor-grab items-center justify-between gap-3 rounded-[6px] border border-[#223a54]/10 bg-white/70 px-3 py-2 text-left shadow-sm transition hover:border-[#2f6073]/30 hover:bg-[#f7efe2] active:cursor-grabbing"
                  draggable
                  key={template.id}
                  onClick={() => addFurniture(template)}
                  onDragStart={(event) =>
                    handleTemplateDragStart(event, template.id)
                  }
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#1e2725]">
                      {template.name}
                    </span>
                    <span className="font-mono text-xs text-[#66706d]">
                      {formatDims(template.widthFt, template.depthFt)}
                    </span>
                  </span>
                  <span
                    className="h-6 w-6 rounded-[5px] border"
                    style={{
                      backgroundColor: template.color,
                      borderColor: template.accent,
                    }}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <PanelTitle icon={<Plus size={17} />} title="Custom item" />
            <div className="mt-3 space-y-3 rounded-[8px] border border-[#223a54]/10 bg-white/65 p-3">
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[#68736f]">
                Name
                <input
                  className="mt-1 h-10 w-full rounded-[6px] border border-[#223a54]/15 bg-white px-3 text-sm font-semibold text-[#1e2725] outline-none transition focus:border-[#2f6073]"
                  onChange={(event) => setCustomName(event.target.value)}
                  value={customName}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Width ft"
                  onChange={setCustomWidthFeet}
                  value={customWidthFeet}
                />
                <NumberField
                  label="Width in"
                  onChange={setCustomWidthInches}
                  value={customWidthInches}
                />
                <NumberField
                  label="Depth ft"
                  onChange={setCustomDepthFeet}
                  value={customDepthFeet}
                />
                <NumberField
                  label="Depth in"
                  onChange={setCustomDepthInches}
                  value={customDepthInches}
                />
              </div>
              <button
                className="flex w-full items-center justify-center gap-2 rounded-[6px] bg-[#2f6073] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#223a54]"
                onClick={addCustomFurniture}
                type="button"
              >
                <Plus size={16} />
                Add custom furniture
              </button>
            </div>
          </div>
        </aside>

        <section className="order-1 min-w-0 lg:order-2">
          <div className="paper-panel flex min-h-[calc(100svh-136px)] flex-col overflow-hidden rounded-[8px]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e2725]/10 bg-[#fbf7ee]/88 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ToolButton
                  active={tool === "move"}
                  icon={<MousePointer2 size={16} />}
                  label="Move"
                  onClick={() => setTool("move")}
                />
                <ToolButton
                  active={tool === "pan"}
                  icon={<Hand size={16} />}
                  label="Pan"
                  onClick={() => setTool("pan")}
                />
                <ToolButton
                  active={tool === "calibrate"}
                  icon={<Ruler size={16} />}
                  label="Scale"
                  onClick={() => setTool("calibrate")}
                />
                <div className="mx-1 h-7 w-px bg-[#1e2725]/10" />
                <IconButton
                  icon={<ZoomOut size={16} />}
                  label="Zoom out"
                  onClick={() => zoomBy(0.84)}
                />
                <span className="flex h-10 min-w-14 items-center justify-center rounded-[6px] bg-white px-2 text-center font-mono text-xs font-semibold text-[#4b5653]">
                  {Math.round(stageScale * 100)}%
                </span>
                <IconButton
                  icon={<ZoomIn size={16} />}
                  label="Zoom in"
                  onClick={() => zoomBy(1.18)}
                />
                <IconButton
                  icon={<Home size={16} />}
                  label="Fit plan"
                  onClick={fitToPlan}
                />
              </div>
              <div className="flex items-center gap-2 rounded-[6px] bg-[#f7efe2] px-3 py-2 text-xs font-semibold text-[#4b5653]">
                {isCalibrated ? (
                  <Check className="text-[#627a52]" size={15} />
                ) : (
                  <AlertTriangle className="text-[#c34d36]" size={15} />
                )}
                {isCalibrated ? "Accurate scale" : "Calibrate before final fit"}
              </div>
            </div>

            <div
              ref={canvasShellRef}
              className="canvas-grid relative min-h-[560px] flex-1 overflow-hidden"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleCanvasDrop}
            >
              <Stage
                draggable={tool === "pan"}
                height={stageSize.height}
                onDragStart={(event) => {
                  if (event.target === stageRef.current) {
                    interactionRef.current = true;
                  }
                }}
                onDragMove={(event) => {
                  const stage = stageRef.current;

                  if (event.target !== stage || !stage) {
                    return;
                  }

                  interactionRef.current = true;
                  setStagePosition({
                    x: stage.x(),
                    y: stage.y(),
                  });
                }}
                onDragEnd={(event) => {
                  const stage = stageRef.current;

                  if (event.target !== stage || !stage) {
                    return;
                  }

                  interactionRef.current = false;
                  setStagePosition({
                    x: stage.x(),
                    y: stage.y(),
                  });
                }}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onTouchCancel={handleStageMouseUp}
                onTouchEnd={handleStageMouseUp}
                onTouchMove={handleStageMouseMove}
                onTouchStart={handleStageMouseDown}
                onWheel={handleWheel}
                ref={stageRef}
                scaleX={stageScale}
                scaleY={stageScale}
                width={stageSize.width}
                x={stagePosition.x}
                y={stagePosition.y}
              >
                <Layer>
                  <Rect
                    fill="#fbf7ee"
                    height={stageBackgroundHeight}
                    listening={!plan}
                    name="canvas-paper"
                    shadowBlur={16}
                    shadowColor="rgba(30, 39, 37, 0.16)"
                    shadowOffset={{ x: 0, y: 10 }}
                    width={stageBackgroundWidth}
                  />
                  {backgroundImage && plan ? (
                    <KonvaImage
                      height={plan.height}
                      image={backgroundImage}
                      name="floor-plan"
                      width={plan.width}
                    />
                  ) : null}

                  {calibrationLine ? (
                    <>
                      <Line
                        dash={[10, 8]}
                        lineCap="round"
                        points={[
                          calibrationLine.x1,
                          calibrationLine.y1,
                          calibrationLine.x2,
                          calibrationLine.y2,
                        ]}
                        stroke="#c34d36"
                        strokeWidth={4 / stageScale}
                      />
                      <Text
                        fill="#c34d36"
                        fontFamily="Geist Mono, monospace"
                        fontSize={14 / stageScale}
                        fontStyle="700"
                        text={
                          isCalibrated && calibration.realLengthFt
                            ? formatFeet(calibration.realLengthFt)
                            : `${Math.round(distance(calibrationLine))} px`
                        }
                        x={(calibrationLine.x1 + calibrationLine.x2) / 2 + 8}
                        y={(calibrationLine.y1 + calibrationLine.y2) / 2 + 8}
                      />
                    </>
                  ) : null}

                  {furniture.map((item) => {
                    const { width, depth } = getItemPixels(item, pixelsPerFoot);
                    const isSelected = item.id === selectedId;
                    const isOverlapping = overlapIds.has(item.id);
                    const fontSize = clamp(Math.min(width, depth) / 5, 10, 18);

                    return (
                      <Group
                        draggable={tool === "move"}
                        key={item.id}
                        onClick={(event) => {
                          event.cancelBubble = true;
                          setSelectedId(item.id);
                          setTool("move");
                        }}
                        onDragStart={(event) => {
                          event.cancelBubble = true;
                          interactionRef.current = true;
                        }}
                        onDragEnd={(event) => {
                          event.cancelBubble = true;
                          interactionRef.current = false;
                          const node = event.target;
                          setFurniture((items) =>
                            items.map((piece) =>
                              piece.id === item.id
                                ? { ...piece, x: node.x(), y: node.y() }
                                : piece,
                            ),
                          );
                        }}
                        onTap={(event) => {
                          event.cancelBubble = true;
                          setSelectedId(item.id);
                          setTool("move");
                        }}
                        onTransformEnd={(event) => {
                          const node = event.target as Konva.Group;
                          const scaleX = node.scaleX();
                          const scaleY = node.scaleY();
                          node.scaleX(1);
                          node.scaleY(1);
                          setFurniture((items) =>
                            items.map((piece) =>
                              piece.id === item.id
                                ? {
                                    ...piece,
                                    x: node.x(),
                                    y: node.y(),
                                    rotation: node.rotation(),
                                    widthFt: Math.max(
                                      MIN_FURNITURE_FEET,
                                      (piece.widthFt * Math.abs(scaleX)),
                                    ),
                                    depthFt: Math.max(
                                      MIN_FURNITURE_FEET,
                                      (piece.depthFt * Math.abs(scaleY)),
                                    ),
                                  }
                                : piece,
                            ),
                          );
                        }}
                        ref={(node) => {
                          itemRefs.current[item.id] = node;
                        }}
                        rotation={item.rotation}
                        x={item.x}
                        y={item.y}
                      >
                        <Rect
                          cornerRadius={7}
                          fill={item.color}
                          height={depth}
                          offsetX={width / 2}
                          offsetY={depth / 2}
                          opacity={0.95}
                          shadowBlur={isSelected ? 10 : 0}
                          shadowColor="rgba(34, 58, 84, 0.25)"
                          stroke={isOverlapping ? "#c34d36" : item.accent}
                          strokeWidth={isOverlapping ? 4 / stageScale : 2 / stageScale}
                          width={width}
                        />
                        <Text
                          align="center"
                          fill="#1e2725"
                          fontFamily="Geist, system-ui, sans-serif"
                          fontSize={fontSize}
                          fontStyle="700"
                          height={depth}
                          offsetX={width / 2}
                          offsetY={depth / 2}
                          padding={6}
                          text={`${item.name}\n${formatDims(
                            item.widthFt,
                            item.depthFt,
                          )}`}
                          verticalAlign="middle"
                          width={width}
                        />
                      </Group>
                    );
                  })}

                  <Transformer
                    anchorFill="#fbf7ee"
                    anchorSize={10}
                    anchorStroke="#223a54"
                    borderDash={[6, 5]}
                    borderStroke="#223a54"
                    boundBoxFunc={(oldBox, newBox) => {
                      if (newBox.width < 12 || newBox.height < 12) {
                        return oldBox;
                      }
                      return newBox;
                    }}
                    enabledAnchors={[
                      "top-left",
                      "top-right",
                      "bottom-left",
                      "bottom-right",
                      "middle-left",
                      "middle-right",
                      "top-center",
                      "bottom-center",
                    ]}
                    ref={transformerRef}
                    rotateEnabled
                  />
                </Layer>
              </Stage>

              {!plan ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-md rounded-[8px] border border-[#223a54]/12 bg-[#fbf7ee]/92 p-5 text-center shadow-xl backdrop-blur">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#223a54] text-white">
                      <Upload size={22} />
                    </div>
                    <h2 className="mt-4 text-xl font-bold text-[#1e2725]">
                      Start with a floor plan
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[#55615d]">
                      Drop a floor plan here, upload a file, or load the sample
                      apartment to test the workflow.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        className="rounded-[6px] bg-[#223a54] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f6073]"
                        onClick={() => fileInputRef.current?.click()}
                        type="button"
                      >
                        Upload
                      </button>
                      <button
                        className="rounded-[6px] border border-[#223a54]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f6efe3]"
                        onClick={useSamplePlan}
                        type="button"
                      >
                        Sample
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="paper-panel order-3 max-h-[calc(100svh-136px)] overflow-auto rounded-[8px] p-4">
          <PanelTitle icon={<Move size={17} />} title="Selection" />
          {selectedItem ? (
            <div className="mt-3 space-y-4">
              <div className="rounded-[8px] border border-[#223a54]/10 bg-white/70 p-3">
                <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[#68736f]">
                  Label
                  <input
                    className="mt-1 h-10 w-full rounded-[6px] border border-[#223a54]/15 bg-white px-3 text-sm font-semibold text-[#1e2725] outline-none transition focus:border-[#2f6073]"
                    onChange={(event) =>
                      updateSelected({ name: event.target.value })
                    }
                    value={selectedItem.name}
                  />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <NumberField
                    label="Width ft"
                    onChange={(value) =>
                      updateSelected({
                        widthFt: Math.max(
                          MIN_FURNITURE_FEET,
                          Number.parseFloat(value) || selectedItem.widthFt,
                        ),
                      })
                    }
                    value={String(Number(selectedItem.widthFt.toFixed(2)))}
                  />
                  <NumberField
                    label="Depth ft"
                    onChange={(value) =>
                      updateSelected({
                        depthFt: Math.max(
                          MIN_FURNITURE_FEET,
                          Number.parseFloat(value) || selectedItem.depthFt,
                        ),
                      })
                    }
                    value={String(Number(selectedItem.depthFt.toFixed(2)))}
                  />
                </div>
                <div className="mt-3 rounded-[6px] bg-[#f7efe2] p-3 font-mono text-xs font-semibold text-[#4b5653]">
                  {formatDims(selectedItem.widthFt, selectedItem.depthFt)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  className="flex items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f6efe3]"
                  onClick={() => rotateSelected(-15)}
                  type="button"
                >
                  <RotateCcw size={16} />
                  Rotate
                </button>
                <button
                  className="flex items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f6efe3]"
                  onClick={() => rotateSelected(15)}
                  type="button"
                >
                  <RotateCw size={16} />
                  Rotate
                </button>
                <button
                  className="flex items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f6efe3]"
                  onClick={duplicateSelected}
                  type="button"
                >
                  <Copy size={16} />
                  Duplicate
                </button>
                <button
                  className="flex items-center justify-center gap-2 rounded-[6px] border border-[#c34d36]/25 bg-[#fff4ed] px-3 py-2.5 text-sm font-semibold text-[#9b3f2b] transition hover:bg-[#ffe8db]"
                  onClick={deleteSelected}
                  type="button"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>

              <div className="rounded-[8px] border border-[#223a54]/10 bg-white/70 p-3">
                <div className="flex items-center justify-between text-sm font-semibold text-[#1e2725]">
                  Rotation
                  <span className="font-mono text-[#66706d]">
                    {Math.round(selectedItem.rotation)} deg
                  </span>
                </div>
                <input
                  className="mt-3 w-full accent-[#223a54]"
                  max={359}
                  min={0}
                  onChange={(event) =>
                    updateSelected({
                      rotation: Number.parseFloat(event.target.value) || 0,
                    })
                  }
                  type="range"
                  value={selectedItem.rotation}
                />
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-[8px] border border-[#223a54]/10 bg-white/70 p-4 text-sm leading-6 text-[#55615d]">
              Select a furniture object to rotate, duplicate, delete, or resize
              it. Drag library items onto the plan to place them at scale.
            </div>
          )}

          <div className="mt-5">
            <PanelTitle icon={<AlertTriangle size={17} />} title="Fit check" />
            <div className="mt-3 rounded-[8px] border border-[#223a54]/10 bg-white/70 p-3">
              {overlapIds.size > 0 ? (
                <div className="flex gap-3 text-sm text-[#9b3f2b]">
                  <AlertTriangle className="mt-0.5 shrink-0" size={17} />
                  <div>
                    <div className="font-bold">
                      {overlapIds.size} item{overlapIds.size === 1 ? "" : "s"}{" "}
                      overlapping
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#7b4c41]">
                      Red outlines show objects that collide. Move or rotate them
                      until the warning clears.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 text-sm text-[#4f6847]">
                  <Check className="mt-0.5 shrink-0" size={17} />
                  <div>
                    <div className="font-bold">No furniture overlaps</div>
                    <p className="mt-1 text-xs leading-5 text-[#60715c]">
                      This is a visual fit check, not wall detection.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5">
            <PanelTitle icon={<Save size={17} />} title="Export" />
            <div className="mt-3 grid gap-2">
              <button
                className="flex items-center justify-center gap-2 rounded-[6px] bg-[#223a54] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f6073]"
                onClick={exportPng}
                type="button"
              >
                <Download size={16} />
                Export PNG
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f6efe3]"
                onClick={exportPdf}
                type="button"
              >
                <FileDown size={16} />
                Export PDF
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-[6px] border border-[#223a54]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#223a54] transition hover:bg-[#f6efe3]"
                onClick={exportJson}
                type="button"
              >
                <Save size={16} />
                Save JSON
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-[8px] border border-[#223a54]/10 bg-[#f7efe2] p-3">
            <div className="flex items-start gap-2 text-xs font-semibold text-[#4b5653]">
              {status.includes("failed") || status.includes("full") ? (
                <AlertTriangle className="mt-0.5 text-[#c34d36]" size={15} />
              ) : (
                <Save className="mt-0.5 text-[#627a52]" size={15} />
              )}
              <span>{status}</span>
            </div>
            <div className="mt-2 font-mono text-xs text-[#66706d]">
              {furniture.length} object{furniture.length === 1 ? "" : "s"} on
              canvas
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function PanelTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.16em] text-[#223a54]">
      {icon}
      {title}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-[#68736f]">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-[6px] border border-[#223a54]/15 bg-white px-3 font-mono text-sm font-semibold text-[#1e2725] outline-none transition focus:border-[#2f6073]"
        min="0"
        onChange={(event) => onChange(event.target.value)}
        step="0.01"
        type="number"
        value={value}
      />
    </label>
  );
}

function ToolButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-[6px] px-3 text-sm font-semibold transition ${
        active
          ? "bg-[#223a54] text-white shadow-sm"
          : "border border-[#223a54]/15 bg-white text-[#223a54] hover:bg-[#f6efe3]"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-10 w-10 items-center justify-center rounded-[6px] border border-[#223a54]/15 bg-white text-[#223a54] transition hover:bg-[#f6efe3]"
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}
