/* =========================================================
   SYNTAX SQUAD — AUTONOMOUS ROVER DASHBOARD
   FINAL DASHBOARD CONTROLLER

   Architecture:

   ESP32
      ↓ USB Serial / JSON
   Flask
      ↓ REST API
   Dashboard

   OpenCV / AprilTag
      ↓
   Flask
      ↓
   Dashboard

   IMPORTANT:
   - Browser never directly controls hardware.
   - ESP32 remains the final safety authority.
   - Frontend never invents course-correction state.
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const CONFIG = {
    telemetryUrl: "/api/telemetry",
    missionUrl: "/api/mission",
    modeUrl: "/api/mode",
    manualControlUrl: "/api/control",

    pollIntervalMs: 1000,
    requestTimeoutMs: 2500,

    maxChartPoints: 30,
    maxLogEntries: 20,

    mapMaxDistance: 10,

    destination: {
        minX: 0,
        maxX: 10,
        minY: 0,
        maxY: 10
    },

    manualCommandIntervalMs: 150,

    ultrasonic: {
        maxRange: 120,
        dangerBelow: 20,
        warningBelow: 50
    }
};


/* =========================================================
   CONSTANTS
   ========================================================= */

const COMMAND_LABELS = {
    F: "FORWARD",
    B: "REVERSE",
    L: "LEFT",
    R: "RIGHT",
    S: "STOP"
};


const CONTROL_MODES = {
    AUTO: "AUTO",
    MANUAL: "MANUAL"
};


const NAVIGATION_STAGES = [
    "START",
    "PATH_FOLLOWING",
    "OBSTACLE_AVOIDANCE",
    "APRILTAG_DETECTION",
    "COURSE_CORRECTION",
    "WAYPOINT_REACHED"
];


const NAVIGATION_STAGE_IDS = [
    "navStep1",
    "navStep2",
    "navStep3",
    "navStep4",
    "navStep5",
    "navStep6"
];


/* =========================================================
   APPLICATION STATE
   ========================================================= */

const state = {
    online: false,

    controlMode: CONTROL_MODES.AUTO,

    previousStatus: null,
    previousNavigationStage: null,
    previousPathDecision: null,
    previousObstacleState: null,
    previousAprilTagDetected: null,
    previousAprilTagId: null,
    previousCourseCorrection: null,
    previousMovement: null,

    lastTelemetry: null,

    requestInFlight: false,

    destination: {
        x: 8,
        y: 8,
        set: false
    },

    missionRunning: false,

    manualCommand: "S",
    manualButtonHeld: false,
    manualCommandTimer: null,

    lastManualRequest: 0,

    chart: {
        labels: [],
        data: []
    },

    lastDistance: 0,

    pollTimer: null,

    pageVisible: true
};


/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => Array.from(
    document.querySelectorAll(selector)
);


const dom = {
    body: document.body,

    /* Header */
    systemStatus: $("#systemStatus"),
    connection: $("#connection"),
    modeBadge: $("#modeBadge"),

    /* Mode */
    autoMode: $("#autoMode"),
    manualMode: $("#manualMode"),

    /* Mission */
    missionState: $("#missionState"),
    missionProgress: $("#missionProgress"),
    progressBar: $("#progressBar"),

    /* Destination */
    autoControlPanel: $("#autoControlPanel"),
    destinationX: $("#destinationX"),
    destinationY: $("#destinationY"),
    setDestination: $("#setDestination"),
    startMission: $("#startMission"),
    stopMission: $("#stopMission"),
    destinationStatus: $("#destinationStatus"),
    destinationStatusDot: $("#destinationStatusDot"),

    /* Manual */
    manualControlPanel: $("#manualControlPanel"),
    manualStop: $("#manualStop"),
    manualCommandStatus: $("#manualCommandStatus"),
    manualCommandFeedback: $("#manualCommandFeedback"),

    /* Telemetry */
    telemetryOnline: $("#telemetryOnline"),
    command: $("#command"),
    commandText: $("#commandText"),
    speed: $("#speed"),
    distance: $("#distance"),
    movementStatus: $("#movementStatus"),
    tag: $("#tag"),
    tagId: $("#tagId"),
    navigationStatus: $("#navigationStatus"),
    navigationDetail: $("#navigationDetail"),
    safetyStatus: $("#safetyStatus"),
    safetyDetail: $("#safetyDetail"),
    connectionState: $("#connectionState"),

    /* Ultrasonic */
    front: $("#front"),
    left: $("#left"),
    right: $("#right"),
    rear: $("#rear"),

    frontBar: $("#frontBar"),
    leftBar: $("#leftBar"),
    rightBar: $("#rightBar"),
    rearBar: $("#rearBar"),

    frontState: $("#frontState"),
    leftState: $("#leftState"),
    rightState: $("#rightState"),
    rearState: $("#rearState"),

    obstacleState: $("#obstacleState"),

    /* IR */
    irLeft: $("#irLeft"),
    irCenter: $("#irCenter"),
    irRight: $("#irRight"),

    irLeftIndicator: $("#irLeftIndicator"),
    irCenterIndicator: $("#irCenterIndicator"),
    irRightIndicator: $("#irRightIndicator"),

    pathDecision: $("#pathDecision"),
    pathFollowingState: $("#pathFollowingState"),

    /* MPU */
    heading: $("#heading"),
    orientation: $("#orientation"),
    orientationState: $("#orientationState"),
    headingArrow: $("#headingArrow"),

    /* Encoder */
    encoderDistance: $("#encoderDistance"),
    encoderMovement: $("#encoderMovement"),
    encoderLeft: $("#encoderLeft"),
    encoderRight: $("#encoderRight"),
    encoderState: $("#encoderState"),

    /* AprilTag / navigation */
    aprilTagDetected: $("#aprilTagDetected"),
    aprilTagId: $("#aprilTagId"),
    navigationStage: $("#navigationStage"),
    courseCorrectionStatus: $("#courseCorrectionStatus"),
    aprilTagNavigationState: $("#aprilTagNavigationState"),

    /* Map */
    roverMarker: $("#roverMarker"),
    destinationPoint: $("#destinationPoint"),
    routeLine: $("#routeLine"),
    mapPositionLabel: $("#mapPositionLabel"),

    /* Chart */
    distanceBig: $("#distanceBig"),
    distanceChart: $("#distanceChart"),

    /* Events */
    eventLog: $("#eventLog"),
    clearLog: $("#clearLog")
};


/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

function isNumber(value) {
    return (
        typeof value === "number" &&
        Number.isFinite(value)
    );
}


function numberOr(value, fallback = 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : fallback;
}


function clamp(value, min, max) {
    return Math.min(
        max,
        Math.max(min, value)
    );
}


function normalizeString(value, fallback = "") {
    if (value === null || value === undefined) {
        return fallback;
    }

    return String(value).trim();
}


function normalizeBoolean(value) {
    if (typeof value === "boolean") {
        return value;
    }

    if (
        value === 1 ||
        value === "1" ||
        String(value).toLowerCase() === "true" ||
        String(value).toLowerCase() === "yes"
    ) {
        return true;
    }

    return false;
}


function titleCase(value) {
    return normalizeString(value)
        .toLowerCase()
        .replace(/(^|\s|_|-)\S/g, match =>
            match.toUpperCase()
        );
}


function normalizeCommand(command) {
    const value = normalizeString(command).toUpperCase();

    if (COMMAND_LABELS[value]) {
        return value;
    }

    const aliases = {
        FORWARD: "F",
        BACKWARD: "B",
        REVERSE: "B",
        LEFT: "L",
        RIGHT: "R",
        STOP: "S"
    };

    return aliases[value] || "S";
}


function normalizeMode(mode) {
    const value = normalizeString(mode).toUpperCase();

    return value === "MANUAL"
        ? CONTROL_MODES.MANUAL
        : CONTROL_MODES.AUTO;
}


function formatDistance(value) {
    return numberOr(value).toFixed(1);
}


function formatSpeed(value) {
    return numberOr(value).toFixed(2);
}


function formatHeading(value) {
    return Math.round(
        ((numberOr(value) % 360) + 360) % 360
    );
}


function nowTime() {
    return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}


/* =========================================================
   EVENT LOG
   ========================================================= */

function addEvent(message, type = "info") {
    if (!dom.eventLog) {
        return;
    }

    const empty = dom.eventLog.querySelector(".event-empty");

    if (empty) {
        empty.remove();
    }

    const entry = document.createElement("div");

    entry.className = `event-entry ${type}`;

    entry.innerHTML = `
        <span class="event-time">${nowTime()}</span>
        <span class="event-indicator"></span>
        <span class="event-message"></span>
    `;

    const messageElement =
        entry.querySelector(".event-message");

    messageElement.textContent = message;

    dom.eventLog.prepend(entry);

    while (
        dom.eventLog.children.length >
        CONFIG.maxLogEntries
    ) {
        dom.eventLog.lastElementChild.remove();
    }
}


function clearEventLog() {
    if (!dom.eventLog) {
        return;
    }

    dom.eventLog.innerHTML = `
        <div class="event-empty">
            Waiting for rover events...
        </div>
    `;
}


/* =========================================================
   CONNECTION STATE
   ========================================================= */

function setConnectionState(online) {
    const wasOnline = state.online;

    state.online = Boolean(online);

    if (dom.connection) {
        dom.connection.classList.toggle(
            "offline",
            !state.online
        );

        dom.connection.classList.toggle(
            "disconnected",
            !state.online
        );
    }

    if (dom.systemStatus) {
        dom.systemStatus.textContent =
            state.online
                ? "CONNECTED"
                : "DISCONNECTED";
    }

    if (dom.connectionState) {
        dom.connectionState.textContent =
            state.online
                ? "ONLINE"
                : "OFFLINE";
    }

    if (dom.telemetryOnline) {
        dom.telemetryOnline.textContent =
            state.online
                ? "ONLINE"
                : "OFFLINE";

        dom.telemetryOnline.classList.toggle(
            "state-danger",
            !state.online
        );
    }

    if (
        !wasOnline &&
        state.online
    ) {
        addEvent(
            "ESP32 / Flask telemetry connected",
            "success"
        );
    }

    if (
        wasOnline &&
        !state.online
    ) {
        addEvent(
            "ESP32 / Flask telemetry disconnected",
            "danger"
        );
    }
}


/* =========================================================
   CONTROL MODE
   ========================================================= */

function setControlModeUI(mode) {
    const normalized = normalizeMode(mode);

    state.controlMode = normalized;

    if (dom.body) {
        dom.body.dataset.mode =
            normalized.toLowerCase();
    }

    if (dom.modeBadge) {
        dom.modeBadge.textContent = normalized;
    }

    if (dom.autoMode) {
        dom.autoMode.classList.toggle(
            "active",
            normalized === CONTROL_MODES.AUTO
        );
    }

    if (dom.manualMode) {
        dom.manualMode.classList.toggle(
            "active",
            normalized === CONTROL_MODES.MANUAL
        );
    }

    if (dom.manualControlPanel) {
        dom.manualControlPanel.classList.toggle(
            "active",
            normalized === CONTROL_MODES.MANUAL
        );
    }

    if (normalized === CONTROL_MODES.AUTO) {
        stopManualCommand(false);
    }
}


async function switchToAuto() {
    stopManualCommand(false);

    const success = await postJson(
        CONFIG.modeUrl,
        {
            mode: CONTROL_MODES.AUTO
        }
    );

    if (success) {
        setControlModeUI(CONTROL_MODES.AUTO);

        addEvent(
            "Control mode changed to AUTO",
            "info"
        );
    } else {
        /*
         * Keep UI responsive even if the backend endpoint
         * is temporarily unavailable.
         *
         * The backend remains responsible for accepting
         * or rejecting the actual mode change.
         */
        setControlModeUI(CONTROL_MODES.AUTO);

        addEvent(
            "AUTO mode selected — backend confirmation unavailable",
            "warning"
        );
    }
}


async function switchToManual() {
    /*
     * Stop autonomous mission before requesting manual mode.
     */
    await postMission({
        action: "stop"
    }, true);

    const success = await postJson(
        CONFIG.modeUrl,
        {
            mode: CONTROL_MODES.MANUAL
        }
    );

    if (success) {
        setControlModeUI(CONTROL_MODES.MANUAL);

        addEvent(
            "Manual mode enabled",
            "warning"
        );
    } else {
        setControlModeUI(CONTROL_MODES.MANUAL);

        addEvent(
            "MANUAL selected — backend confirmation unavailable",
            "warning"
        );
    }
}


/* =========================================================
   NETWORK REQUEST HELPER
   ========================================================= */

async function fetchWithTimeout(
    url,
    options = {},
    timeout = CONFIG.requestTimeoutMs
) {
    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        timeout
    );

    try {
        return await fetch(
            url,
            {
                ...options,
                signal: controller.signal
            }
        );
    } finally {
        clearTimeout(timer);
    }
}


async function postJson(url, payload) {
    try {
        const response = await fetchWithTimeout(
            url,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        return true;

    } catch (error) {
        console.warn(
            `POST ${url} failed:`,
            error
        );

        return false;
    }
}


/* =========================================================
   TELEMETRY NORMALIZATION
   ========================================================= */

/*
 * This function accepts the NEW structured telemetry format:
 *
 * {
 *   online,
 *   mode,
 *   command,
 *   speed,
 *   distance,
 *   ir: {},
 *   ultrasonic: {},
 *   encoder: {},
 *   mpu: {},
 *   apriltag: {},
 *   navigation: {},
 *   safety: {}
 * }
 *
 * It also supports the older flat format so the dashboard
 * does not immediately break during backend migration.
 */

function normalizeTelemetry(raw) {
    const telemetry = raw || {};

    const ultrasonic =
        telemetry.ultrasonic ||
        telemetry.sensors ||
        {};

    const ir =
        telemetry.ir ||
        {};

    const encoder =
        telemetry.encoder ||
        {};

    const mpu =
        telemetry.mpu ||
        telemetry.orientation ||
        {};

    const april =
        telemetry.apriltag ||
        telemetry.aprilTag ||
        {};

    const navigation =
        telemetry.navigation ||
        {};

    const safety =
        telemetry.safety ||
        {};

    const command =
        normalizeCommand(
            telemetry.command
        );

    const speed = numberOr(
        telemetry.speed,
        0
    );

    const distance = numberOr(
        telemetry.distance ??
        encoder.distance,
        0
    );

    const front = numberOr(
        ultrasonic.front ??
        telemetry.front,
        0
    );

    const left = numberOr(
        ultrasonic.left ??
        telemetry.left,
        0
    );

    const right = numberOr(
        ultrasonic.right ??
        telemetry.right,
        0
    );

    const rear = numberOr(
        ultrasonic.rear ??
        telemetry.rear,
        0
    );

    const irLeft = numberOr(
        ir.left ??
        telemetry.irLeft,
        0
    );

    const irCenter = numberOr(
        ir.center ??
        telemetry.irCenter,
        0
    );

    const irRight = numberOr(
        ir.right ??
        telemetry.irRight,
        0
    );

    const pathDecision =
        normalizeString(
            ir.path ??
            ir.decision ??
            telemetry.path ??
            telemetry.pathDecision,
            ""
        ).toUpperCase();

    const heading = numberOr(
        mpu.heading ??
        telemetry.heading,
        0
    );

    const orientation =
        normalizeString(
            mpu.orientation ??
            telemetry.orientation,
            ""
        ).toUpperCase();

    const encoderLeft = numberOr(
        encoder.left ??
        encoder.leftPulses ??
        telemetry.encoderLeft,
        0
    );

    const encoderRight = numberOr(
        encoder.right ??
        encoder.rightPulses ??
        telemetry.encoderRight,
        0
    );

    const tagDetected =
        normalizeBoolean(
            april.detected ??
            telemetry.apriltagDetected ??
            telemetry.tagDetected
        );

    const tagId =
        april.id ??
        telemetry.apriltagId ??
        telemetry.tagId ??
        null;

    const navigationStage =
        normalizeNavigationStage(
            navigation.stage ??
            telemetry.navigationStage ??
            telemetry.stage
        );

    const navigationStatus =
        normalizeString(
            navigation.status ??
            telemetry.navigationStatus ??
            telemetry.status,
            ""
        ).toUpperCase();

    const safetyStatus =
        normalizeString(
            safety.status ??
            telemetry.safetyStatus,
            ""
        ).toUpperCase();

    const obstacleState =
        normalizeObstacleState(
            telemetry.obstacleState ??
            navigation.obstacleState ??
            safety.obstacleState ??
            safetyStatus
        );

    const courseCorrection =
        normalizeCourseCorrection(
            navigation.courseCorrection ??
            navigation.status ??
            telemetry.courseCorrection
        );

    const movement =
        normalizeMovement(
            telemetry.movement ??
            encoder.movement ??
            command,
            speed
        );

    return {
        online:
            telemetry.online !== undefined
                ? normalizeBoolean(telemetry.online)
                : true,

        mode:
            normalizeMode(
                telemetry.mode ??
                state.controlMode
            ),

        command,

        speed,

        distance,

        ultrasonic: {
            front,
            left,
            right,
            rear
        },

        ir: {
            left: irLeft,
            center: irCenter,
            right: irRight,
            path: pathDecision
        },

        encoder: {
            left: encoderLeft,
            right: encoderRight
        },

        mpu: {
            heading,
            orientation
        },

        apriltag: {
            detected: tagDetected,
            id: tagId
        },

        navigation: {
            stage: navigationStage,
            status: navigationStatus,
            obstacleState,
            courseCorrection
        },

        safety: {
            status: safetyStatus || "CLEAR"
        },

        movement
    };
}


function normalizeNavigationStage(stage) {
    const value =
        normalizeString(stage)
            .toUpperCase()
            .replace(/-/g, "_")
            .replace(/\s+/g, "_");

    const aliases = {
        IDLE: "START",
        READY: "START",
        RUNNING: "PATH_FOLLOWING",
        NAVIGATING: "PATH_FOLLOWING",
        PATH: "PATH_FOLLOWING",
        LINE_FOLLOWING: "PATH_FOLLOWING",
        OBSTACLE: "OBSTACLE_AVOIDANCE",
        AVOIDING: "OBSTACLE_AVOIDANCE",
        APRILTAG: "APRILTAG_DETECTION",
        TAG_DETECTED: "APRILTAG_DETECTION",
        CORRECTING: "COURSE_CORRECTION",
        CORRECTION: "COURSE_CORRECTION",
        ARRIVED: "WAYPOINT_REACHED",
        COMPLETE: "WAYPOINT_REACHED",
        COMPLETED: "WAYPOINT_REACHED"
    };

    const normalized =
        aliases[value] || value;

    return NAVIGATION_STAGES.includes(normalized)
        ? normalized
        : "START";
}


function normalizeObstacleState(value) {
    const normalized =
        normalizeString(value)
            .toUpperCase()
            .replace(/-/g, "_")
            .replace(/\s+/g, "_");

    if (
        normalized.includes("AVOID") ||
        normalized.includes("BLOCKED")
    ) {
        return "AVOIDING OBSTACLE";
    }

    if (
        normalized.includes("DETECTED") ||
        normalized.includes("OBSTACLE")
    ) {
        return "OBSTACLE DETECTED";
    }

    if (
        normalized.includes("RESUM") ||
        normalized.includes("CLEAR")
    ) {
        return "PATH CLEAR — RESUMING";
    }

    return "PATH CLEAR";
}


function normalizeCourseCorrection(value) {
    const normalized =
        normalizeString(value)
            .toUpperCase()
            .replace(/-/g, "_")
            .replace(/\s+/g, "_");

    if (
        normalized.includes("CORRECT") ||
        normalized === "CORRECTING" ||
        normalized === "ACTIVE"
    ) {
        return "COURSE CORRECTION";
    }

    return "NOT ACTIVE";
}


function normalizeMovement(value, speed = 0) {
    const normalized =
        normalizeString(value)
            .toUpperCase();

    if (
        normalized === "MOVING" ||
        normalized === "RUNNING"
    ) {
        return "MOVING";
    }

    if (
        normalized === "STOPPED" ||
        normalized === "STOP"
    ) {
        return "STOPPED";
    }

    if (Math.abs(speed) > 0.01) {
        return "MOVING";
    }

    return "STOPPED";
}


/* =========================================================
   TELEMETRY RENDER
   ========================================================= */

function renderTelemetry(telemetry) {
    state.lastTelemetry = telemetry;

    renderConnection(telemetry);
    renderModeFromTelemetry(telemetry);

    renderCommand(telemetry);
    renderMovement(telemetry);
    renderDistance(telemetry);

    renderUltrasonic(telemetry);
    renderIR(telemetry);
    renderMPU(telemetry);
    renderEncoder(telemetry);

    renderAprilTag(telemetry);
    renderNavigation(telemetry);
    renderSafety(telemetry);

    renderMission(telemetry);

    updateRouteView(telemetry);
    updateDistanceChart(telemetry);
    detectEvents(telemetry);
}


/* =========================================================
   CONNECTION FROM TELEMETRY
   ========================================================= */

function renderConnection(telemetry) {
    setConnectionState(
        telemetry.online !== false
    );
}


/* =========================================================
   MODE
   ========================================================= */

function renderModeFromTelemetry(telemetry) {
    /*
     * Only trust a mode explicitly provided by backend.
     * Otherwise retain local UI state.
     */
    if (
        telemetry.mode === CONTROL_MODES.AUTO ||
        telemetry.mode === CONTROL_MODES.MANUAL
    ) {
        setControlModeUI(
            telemetry.mode
        );
    }
}


/* =========================================================
   COMMAND
   ========================================================= */

function renderCommand(telemetry) {
    const command =
        normalizeCommand(
            telemetry.command
        );

    if (dom.command) {
        dom.command.textContent =
            command;
    }

    if (dom.commandText) {
        dom.commandText.textContent =
            COMMAND_LABELS[command];
    }
}


/* =========================================================
   MOVEMENT
   ========================================================= */

function renderMovement(telemetry) {
    const movement =
        telemetry.movement;

    if (dom.movementStatus) {
        dom.movementStatus.textContent =
            movement;
    }

    if (dom.encoderMovement) {
        dom.encoderMovement.textContent =
            movement;
    }

    if (dom.encoderState) {
        dom.encoderState.textContent =
            movement === "MOVING"
                ? "ACTIVE"
                : "STOPPED";
    }

    if (dom.movementStatus) {
        dom.movementStatus.classList.toggle(
            "state-clear",
            movement === "MOVING"
        );
    }
}


/* =========================================================
   DISTANCE
   ========================================================= */

function renderDistance(telemetry) {
    const distance =
        numberOr(
            telemetry.distance
        );

    if (dom.distance) {
        dom.distance.textContent =
            formatDistance(distance);
    }

    if (dom.encoderDistance) {
        dom.encoderDistance.textContent =
            formatDistance(distance);
    }

    if (dom.distanceBig) {
        dom.distanceBig.textContent =
            formatDistance(distance);
    }
}


/* =========================================================
   ULTRASONIC
   ========================================================= */

function renderUltrasonic(telemetry) {
    const sensors = telemetry.ultrasonic;

    updateSensor(
        sensors.front,
        dom.front,
        dom.frontBar,
        dom.frontState,
        "front"
    );

    updateSensor(
        sensors.left,
        dom.left,
        dom.leftBar,
        dom.leftState,
        "left"
    );

    updateSensor(
        sensors.right,
        dom.right,
        dom.rightBar,
        dom.rightState,
        "right"
    );

    updateSensor(
        sensors.rear,
        dom.rear,
        dom.rearBar,
        dom.rearState,
        "rear"
    );

    const obstacle =
        telemetry.navigation.obstacleState;

    if (dom.obstacleState) {
        dom.obstacleState.textContent =
            obstacle;

        dom.obstacleState.classList.remove(
            "state-clear",
            "state-warning",
            "state-danger"
        );

        if (
            obstacle === "PATH CLEAR" ||
            obstacle === "PATH CLEAR — RESUMING"
        ) {
            dom.obstacleState.classList.add(
                "state-clear"
            );
        } else if (
            obstacle === "OBSTACLE DETECTED"
        ) {
            dom.obstacleState.classList.add(
                "state-warning"
            );
        } else {
            dom.obstacleState.classList.add(
                "state-danger"
            );
        }
    }
}


function updateSensor(
    value,
    valueElement,
    barElement,
    stateElement,
    sensorName
) {
    const distance =
        numberOr(value);

    if (valueElement) {
        valueElement.textContent =
            distance > 0
                ? Math.round(distance)
                : "—";
    }

    if (barElement) {
        const percentage =
            distance > 0
                ? clamp(
                    (distance /
                        CONFIG.ultrasonic.maxRange) *
                    100,
                    5,
                    100
                )
                : 5;

        barElement.style.width =
            `${percentage}%`;
    }

    const card =
        valueElement?.closest(".sensor-card");

    if (card) {
        card.classList.remove(
            "warning",
            "danger"
        );
    }

    let label = "WAITING";
    let stateClass = "";

    if (distance > 0) {
        if (
            distance <
            CONFIG.ultrasonic.dangerBelow
        ) {
            label = "DANGER";
            stateClass = "danger";

            if (card) {
                card.classList.add("danger");
            }

        } else if (
            distance <
            CONFIG.ultrasonic.warningBelow
        ) {
            label = "WARNING";
            stateClass = "warning";

            if (card) {
                card.classList.add("warning");
            }

        } else {
            label = "CLEAR";
        }
    }

    if (stateElement) {
        stateElement.textContent =
            label;

        stateElement.classList.remove(
            "state-clear",
            "state-warning",
            "state-danger"
        );

        if (stateClass === "danger") {
            stateElement.classList.add(
                "state-danger"
            );
        } else if (stateClass === "warning") {
            stateElement.classList.add(
                "state-warning"
            );
        } else if (label === "CLEAR") {
            stateElement.classList.add(
                "state-clear"
            );
        }
    }
}


/* =========================================================
   IR PATH FOLLOWING
   ========================================================= */

function renderIR(telemetry) {
    const ir = telemetry.ir;

    setText(
        dom.irLeft,
        ir.left
    );

    setText(
        dom.irCenter,
        ir.center
    );

    setText(
        dom.irRight,
        ir.right
    );

    updateIRIndicator(
        dom.irLeftIndicator,
        ir.left
    );

    updateIRIndicator(
        dom.irCenterIndicator,
        ir.center
    );

    updateIRIndicator(
        dom.irRightIndicator,
        ir.right
    );

    const decision =
        ir.path ||
        "LOST";

    if (dom.pathDecision) {
        dom.pathDecision.textContent =
            decision;
    }

    if (dom.pathFollowingState) {
        dom.pathFollowingState.textContent =
            decision === "LOST"
                ? "LOST"
                : "ACTIVE";

        dom.pathFollowingState.classList.toggle(
            "state-danger",
            decision === "LOST"
        );

        dom.pathFollowingState.classList.toggle(
            "state-clear",
            decision !== "LOST"
        );
    }
}


function updateIRIndicator(
    element,
    value
) {
    if (!element) {
        return;
    }

    element.classList.remove(
        "active",
        "inactive"
    );

    const active =
        normalizeBoolean(value);

    element.classList.add(
        active
            ? "active"
            : "inactive"
    );
}


/* =========================================================
   MPU
   ========================================================= */

function renderMPU(telemetry) {
    const mpu = telemetry.mpu;

    const heading =
        formatHeading(
            mpu.heading
        );

    const orientation =
        mpu.orientation ||
        deriveOrientation(
            telemetry.command
        );

    if (dom.heading) {
        dom.heading.textContent =
            heading;
    }

    if (dom.orientation) {
        dom.orientation.textContent =
            orientation;
    }

    if (dom.orientationState) {
        dom.orientationState.textContent =
            orientation;
    }

    if (dom.headingArrow) {
        dom.headingArrow.style.transform =
            `rotate(${heading}deg)`;
    }
}


function deriveOrientation(command) {
    switch (
        normalizeCommand(command)
    ) {
        case "L":
            return "TURNING LEFT";

        case "R":
            return "TURNING RIGHT";

        case "F":
        case "B":
            return "STRAIGHT";

        default:
            return "STRAIGHT";
    }
}


/* =========================================================
   ENCODER
   ========================================================= */

function renderEncoder(telemetry) {
    const encoder =
        telemetry.encoder;

    if (dom.encoderLeft) {
        dom.encoderLeft.textContent =
            Math.round(
                encoder.left
            );
    }

    if (dom.encoderRight) {
        dom.encoderRight.textContent =
            Math.round(
                encoder.right
            );
    }

    if (dom.encoderDistance) {
        dom.encoderDistance.textContent =
            formatDistance(
                telemetry.distance
            );
    }
}


/* =========================================================
   APRILTAG
   ========================================================= */

function renderAprilTag(telemetry) {
    const april =
        telemetry.apriltag;

    if (dom.tag) {
        dom.tag.textContent =
            april.detected
                ? "DETECTED"
                : "NOT DETECTED";

        dom.tag.classList.toggle(
            "state-clear",
            april.detected
        );

        dom.tag.classList.toggle(
            "state-muted",
            !april.detected
        );
    }

    if (dom.tagId) {
        dom.tagId.textContent =
            april.detected &&
            april.id !== null
                ? `ID ${april.id}`
                : "ID —";
    }

    if (dom.aprilTagDetected) {
        dom.aprilTagDetected.textContent =
            april.detected
                ? "DETECTED"
                : "NOT DETECTED";
    }

    if (dom.aprilTagId) {
        dom.aprilTagId.textContent =
            april.detected &&
            april.id !== null
                ? april.id
                : "—";
    }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function renderNavigation(telemetry) {
    const navigation =
        telemetry.navigation;

    const stage =
        navigation.stage;

    const status =
        navigation.status ||
        stage;

    if (dom.navigationStatus) {
        dom.navigationStatus.textContent =
            formatNavigationLabel(stage);
    }

    if (dom.navigationDetail) {
        dom.navigationDetail.textContent =
            status || "WAITING";
    }

    if (dom.navigationStage) {
        dom.navigationStage.textContent =
            formatNavigationLabel(stage);
    }

    if (dom.aprilTagNavigationState) {
        dom.aprilTagNavigationState.textContent =
            formatNavigationLabel(stage);
    }

    if (dom.courseCorrectionStatus) {
        dom.courseCorrectionStatus.textContent =
            navigation.courseCorrection;
    }

    updateNavigationStages(stage);
}


function formatNavigationLabel(stage) {
    return normalizeString(stage)
        .replace(/_/g, " ");
}


function updateNavigationStages(currentStage) {
    const currentIndex =
        NAVIGATION_STAGES.indexOf(
            currentStage
        );

    NAVIGATION_STAGE_IDS.forEach(
        (id, index) => {
            const element =
                document.getElementById(id);

            if (!element) {
                return;
            }

            element.classList.remove(
                "active",
                "completed"
            );

            if (
                currentIndex >= 0 &&
                index < currentIndex
            ) {
                element.classList.add(
                    "completed"
                );
            }

            if (
                currentIndex >= 0 &&
                index === currentIndex
            ) {
                element.classList.add(
                    "active"
                );
            }
        }
    );
}


/* =========================================================
   SAFETY
   ========================================================= */

function renderSafety(telemetry) {
    const safety =
        telemetry.safety.status;

    const obstacle =
        telemetry.navigation.obstacleState;

    let displayStatus =
        safety || "CLEAR";

    if (
        obstacle === "AVOIDING OBSTACLE"
    ) {
        displayStatus =
            "AVOIDING OBSTACLE";
    } else if (
        obstacle === "OBSTACLE DETECTED"
    ) {
        displayStatus =
            "OBSTACLE DETECTED";
    }

    if (dom.safetyStatus) {
        dom.safetyStatus.textContent =
            displayStatus;
    }

    if (dom.safetyDetail) {
        dom.safetyDetail.textContent =
            obstacle;
    }

    if (dom.safetyStatus) {
        dom.safetyStatus.classList.remove(
            "state-clear",
            "state-warning",
            "state-danger"
        );

        if (
            displayStatus === "CLEAR" ||
            displayStatus.includes("RESUMING")
        ) {
            dom.safetyStatus.classList.add(
                "state-clear"
            );
        } else if (
            displayStatus.includes("DETECTED")
        ) {
            dom.safetyStatus.classList.add(
                "state-warning"
            );
        } else {
            dom.safetyStatus.classList.add(
                "state-danger"
            );
        }
    }
}


/* =========================================================
   MISSION
   ========================================================= */

function renderMission(telemetry) {
    const stage =
        telemetry.navigation.stage;

    let progress = 0;

    const index =
        NAVIGATION_STAGES.indexOf(
            stage
        );

    if (index >= 0) {
        progress =
            (index /
                (NAVIGATION_STAGES.length - 1)) *
            100;
    }

    if (
        stage === "WAYPOINT_REACHED"
    ) {
        progress = 100;
    }

    if (dom.missionProgress) {
        dom.missionProgress.textContent =
            `${Math.round(progress)}%`;
    }

    if (dom.progressBar) {
        dom.progressBar.style.width =
            `${progress}%`;
    }

    if (dom.missionState) {
        dom.missionState.textContent =
            formatNavigationLabel(stage);
    }
}


/* =========================================================
   ROUTE / WAYPOINT VIEW
   ========================================================= */

function updateRouteView(telemetry) {
    const distance =
        numberOr(
            telemetry.distance
        );

    /*
     * This is deliberately only an approximate route-progress
     * visualization. It does NOT claim to be SLAM or real X/Y
     * localization.
     */
    const destinationX =
        state.destination.x;

    const destinationY =
        state.destination.y;

    let progress = 0;

    if (
        state.destination.set
    ) {
        progress =
            clamp(
                distance /
                CONFIG.mapMaxDistance,
                0,
                1
            );
    }

    const startX = 10;
    const startY = 16;

    const endX = 90;
    const endY = 84;

    const roverX =
        startX +
        (endX - startX) *
        progress;

    const roverY =
        startY +
        (endY - startY) *
        progress;

    if (dom.roverMarker) {
        dom.roverMarker.style.left =
            `${roverX}%`;

        dom.roverMarker.style.bottom =
            `${roverY}%`;
    }

    if (dom.mapPositionLabel) {
        dom.mapPositionLabel.textContent =
            state.destination.set
                ? "APPROXIMATE PROGRESS"
                : "APPROXIMATE";
    }

    updateDestinationMapPoint(
        destinationX,
        destinationY
    );
}


function updateDestinationMapPoint(
    x,
    y
) {
    if (!dom.destinationPoint) {
        return;
    }

    const normalizedX =
        clamp(
            (
                numberOr(x) -
                CONFIG.destination.minX
            ) /
            (
                CONFIG.destination.maxX -
                CONFIG.destination.minX
            ),
            0,
            1
        );

    const normalizedY =
        clamp(
            (
                numberOr(y) -
                CONFIG.destination.minY
            ) /
            (
                CONFIG.destination.maxY -
                CONFIG.destination.minY
            ),
            0,
            1
        );

    dom.destinationPoint.style.right =
        `${10 + normalizedX * 5}%`;

    dom.destinationPoint.style.top =
        `${10 + (1 - normalizedY) * 10}%`;
}


/* =========================================================
   DISTANCE CHART
   ========================================================= */

let distanceChartInstance = null;


function initializeChart() {
    if (
        !dom.distanceChart ||
        typeof Chart === "undefined"
    ) {
        return;
    }

    const context =
        dom.distanceChart.getContext(
            "2d"
        );

    distanceChartInstance =
        new Chart(
            context,
            {
                type: "line",

                data: {
                    labels: [],
                    datasets: [
                        {
                            label:
                                "Distance (m)",

                            data: [],

                            borderWidth: 2,

                            pointRadius: 0,

                            tension: 0.35,

                            fill: true
                        }
                    ]
                },

                options: {
                    responsive: true,

                    maintainAspectRatio: false,

                    animation: false,

                    plugins: {
                        legend: {
                            display: false
                        },

                        tooltip: {
                            mode: "index",
                            intersect: false
                        }
                    },

                    scales: {
                        x: {
                            display: false,

                            grid: {
                                display: false
                            }
                        },

                        y: {
                            beginAtZero: true,

                            ticks: {
                                color: "#718693",

                                font: {
                                    size: 10
                                }
                            },

                            grid: {
                                color:
                                    "rgba(110,150,180,0.08)"
                            }
                        }
                    }
                }
            }
        );
}


function updateDistanceChart(
    telemetry
) {
    const distance =
        numberOr(
            telemetry.distance
        );

    const timeLabel =
        new Date()
            .toLocaleTimeString([], {
                minute: "2-digit",
                second: "2-digit"
            });

    state.chart.labels.push(
        timeLabel
    );

    state.chart.data.push(
        distance
    );

    while (
        state.chart.labels.length >
        CONFIG.maxChartPoints
    ) {
        state.chart.labels.shift();
        state.chart.data.shift();
    }

    if (distanceChartInstance) {
        distanceChartInstance.data.labels =
            state.chart.labels;

        distanceChartInstance.data.datasets[0].data =
            state.chart.data;

        distanceChartInstance.update(
            "none"
        );
    }

    if (dom.distanceBig) {
        dom.distanceBig.textContent =
            formatDistance(distance);
    }
}


/* =========================================================
   EVENT DETECTION
   ========================================================= */

function detectEvents(telemetry) {
    const navigation =
        telemetry.navigation;

    const obstacle =
        navigation.obstacleState;

    const path =
        telemetry.ir.path;

    const tagDetected =
        telemetry.apriltag.detected;

    const tagId =
        telemetry.apriltag.id;

    const courseCorrection =
        navigation.courseCorrection;

    const movement =
        telemetry.movement;

    const stage =
        navigation.stage;


    /*
     * Connection
     */
    if (
        state.online &&
        state.previousStatus === false
    ) {
        addEvent(
            "ESP32 connection restored",
            "success"
        );
    }


    /*
     * Navigation stage
     */
    if (
        stage &&
        stage !==
        state.previousNavigationStage
    ) {
        if (
            state.previousNavigationStage !== null
        ) {
            addEvent(
                `Navigation: ${formatNavigationLabel(stage)}`,
                "info"
            );
        }

        state.previousNavigationStage =
            stage;
    }


    /*
     * Path following
     */
    if (
        path &&
        path !== state.previousPathDecision
    ) {
        if (
            path === "LEFT" ||
            path === "RIGHT" ||
            path === "FORWARD"
        ) {
            addEvent(
                `Path following: ${path}`,
                "info"
            );
        } else if (
            path === "LOST"
        ) {
            addEvent(
                "Path following: PATH LOST",
                "warning"
            );
        }

        state.previousPathDecision =
            path;
    }


    /*
     * Obstacle state
     */
    if (
        obstacle &&
        obstacle !== state.previousObstacleState
    ) {
        if (
            obstacle === "OBSTACLE DETECTED"
        ) {
            addEvent(
                "Obstacle detected",
                "warning"
            );
        } else if (
            obstacle === "AVOIDING OBSTACLE"
        ) {
            addEvent(
                "Avoiding obstacle",
                "warning"
            );
        } else if (
            obstacle === "PATH CLEAR — RESUMING"
        ) {
            addEvent(
                "Path clear — resuming",
                "success"
            );
        }

        state.previousObstacleState =
            obstacle;
    }


    /*
     * AprilTag
     */
    if (
        tagDetected &&
        !state.previousAprilTagDetected
    ) {
        addEvent(
            tagId !== null
                ? `AprilTag detected — ID ${tagId}`
                : "AprilTag detected",
            "success"
        );
    }

    if (
        !tagDetected &&
        state.previousAprilTagDetected === true
    ) {
        addEvent(
            "AprilTag no longer detected",
            "info"
        );
    }

    state.previousAprilTagDetected =
        tagDetected;

    if (
        tagDetected &&
        tagId !== null &&
        tagId !== state.previousAprilTagId
    ) {
        addEvent(
            `AprilTag ID changed to ${tagId}`,
            "info"
        );

        state.previousAprilTagId =
            tagId;
    }


    /*
     * Course correction
     *
     * IMPORTANT:
     * This is only logged if backend reports it.
     */
    if (
        courseCorrection ===
        "COURSE CORRECTION" &&
        state.previousCourseCorrection !==
        "COURSE CORRECTION"
    ) {
        addEvent(
            "Course correction active",
            "warning"
        );
    }

    state.previousCourseCorrection =
        courseCorrection;


    /*
     * Movement
     */
    if (
        movement &&
        movement !== state.previousMovement
    ) {
        if (movement === "MOVING") {
            addEvent(
                "Rover moving",
                "info"
            );
        } else if (
            movement === "STOPPED"
        ) {
            addEvent(
                "Rover stopped",
                "info"
            );
        }

        state.previousMovement =
            movement;
    }
}


/* =========================================================
   DESTINATION
   ========================================================= */

function readDestinationInputs() {
    const x =
        clamp(
            numberOr(
                dom.destinationX?.value,
                0
            ),
            CONFIG.destination.minX,
            CONFIG.destination.maxX
        );

    const y =
        clamp(
            numberOr(
                dom.destinationY?.value,
                0
            ),
            CONFIG.destination.minY,
            CONFIG.destination.maxY
        );

    return {
        x,
        y
    };
}


function setDestinationUI(
    x,
    y
) {
    state.destination.x = x;
    state.destination.y = y;
    state.destination.set = true;

    if (dom.destinationX) {
        dom.destinationX.value = x;
    }

    if (dom.destinationY) {
        dom.destinationY.value = y;
    }

    if (dom.destinationStatus) {
        dom.destinationStatus.textContent =
            `WAYPOINT ${x.toFixed(1)}, ${y.toFixed(1)}`;
    }

    if (dom.destinationStatusDot) {
        dom.destinationStatusDot.style.background =
            "var(--green)";

        dom.destinationStatusDot.style.boxShadow =
            "0 0 12px rgba(66,230,164,0.45)";
    }

    updateDestinationMapPoint(
        x,
        y
    );
}


async function setDestination() {
    const destination =
        readDestinationInputs();

    setDestinationUI(
        destination.x,
        destination.y
    );

    const success =
        await postMission(
            {
                action: "set_destination",

                x: destination.x,
                y: destination.y
            },
            true
        );

    if (success) {
        addEvent(
            `Waypoint set: (${destination.x.toFixed(1)}, ${destination.y.toFixed(1)})`,
            "success"
        );
    } else {
        addEvent(
            "Waypoint selected — backend confirmation unavailable",
            "warning"
        );
    }
}


/* =========================================================
   MISSION COMMANDS
   ========================================================= */

async function startMission() {
    if (
        state.controlMode !==
        CONTROL_MODES.AUTO
    ) {
        addEvent(
            "Mission start blocked: switch to AUTO mode",
            "warning"
        );

        return;
    }

    if (!state.destination.set) {
        const destination =
            readDestinationInputs();

        setDestinationUI(
            destination.x,
            destination.y
        );
    }

    const destination =
        state.destination;

    const success =
        await postMission(
            {
                action: "start",

                x: destination.x,
                y: destination.y
            },
            true
        );

    if (success) {
        state.missionRunning = true;

        addEvent(
            "Mission started",
            "success"
        );
    } else {
        addEvent(
            "Mission start request failed",
            "danger"
        );
    }
}


async function stopMission() {
    const success =
        await postMission(
            {
                action: "stop"
            },
            true
        );

    state.missionRunning = false;

    stopManualCommand(false);

    if (success) {
        addEvent(
            "Mission stopped",
            "warning"
        );
    } else {
        addEvent(
            "Mission stop requested — backend confirmation unavailable",
            "warning"
        );
    }
}


async function postMission(
    payload,
    silent = false
) {
    const success =
        await postJson(
            CONFIG.missionUrl,
            payload
        );

    if (
        !success &&
        !silent
    ) {
        addEvent(
            "Mission API request failed",
            "danger"
        );
    }

    return success;
}


/* =========================================================
   MAP CLICK → WAYPOINT
   ========================================================= */

function initializeMapClick() {
    const map =
        $(".rover-map");

    if (!map) {
        return;
    }

    map.addEventListener(
        "click",
        async (event) => {
            /*
             * Convert click position into approximate
             * waypoint coordinates.
             */
            const rect =
                map.getBoundingClientRect();

            const xRatio =
                clamp(
                    (
                        event.clientX -
                        rect.left
                    ) /
                    rect.width,
                    0,
                    1
                );

            const yRatio =
                clamp(
                    (
                        event.clientY -
                        rect.top
                    ) /
                    rect.height,
                    0,
                    1
                );

            const x =
                CONFIG.destination.minX +
                xRatio *
                (
                    CONFIG.destination.maxX -
                    CONFIG.destination.minX
                );

            const y =
                CONFIG.destination.maxY -
                yRatio *
                (
                    CONFIG.destination.maxY -
                    CONFIG.destination.minY
                );

            setDestinationUI(
                x,
                y
            );

            await postMission(
                {
                    action:
                        "set_destination",

                    x,
                    y
                },
                true
            );

            addEvent(
                `Waypoint selected from route view: (${x.toFixed(1)}, ${y.toFixed(1)})`,
                "info"
            );
        }
    );
}


/* =========================================================
   MANUAL CONTROL
   ========================================================= */

function normalizeManualCommand(
    command
) {
    return normalizeCommand(
        command
    );
}


async function sendManualCommand(
    command
) {
    if (
        state.controlMode !==
        CONTROL_MODES.MANUAL
    ) {
        return;
    }

    const normalized =
        normalizeManualCommand(
            command
        );

    state.manualCommand =
        normalized;

    updateManualCommandUI(
        normalized
    );

    /*
     * Avoid flooding Flask with duplicate
     * commands faster than required.
     */
    const now =
        Date.now();

    if (
        now -
        state.lastManualRequest <
        CONFIG.manualCommandIntervalMs
    ) {
        return;
    }

    state.lastManualRequest =
        now;

    await postManualControl(
        normalized
    );
}


async function postManualControl(
    command
) {
    if (
        state.controlMode !==
        CONTROL_MODES.MANUAL
    ) {
        return false;
    }

    return await postJson(
        CONFIG.manualControlUrl,
        {
            command,
            mode: CONTROL_MODES.MANUAL
        }
    );
}


function updateManualCommandUI(
    command
) {
    const label =
        COMMAND_LABELS[command] ||
        "STOP";

    if (dom.manualCommandStatus) {
        dom.manualCommandStatus.textContent =
            label;
    }

    if (dom.manualCommandFeedback) {
        dom.manualCommandFeedback.textContent =
            `MANUAL COMMAND: ${label}`;
    }

    $$(".manual-button").forEach(
        button => {
            button.classList.toggle(
                "held",
                normalizeManualCommand(
                    button.dataset.command
                ) === command &&
                state.manualButtonHeld
            );
        }
    );
}


function startManualCommand(
    command
) {
    if (
        state.controlMode !==
        CONTROL_MODES.MANUAL
    ) {
        return;
    }

    state.manualButtonHeld = true;

    const normalized =
        normalizeManualCommand(
            command
        );

    state.manualCommand =
        normalized;

    updateManualCommandUI(
        normalized
    );

    sendManualCommand(
        normalized
    );

    clearInterval(
        state.manualCommandTimer
    );

    /*
     * Continue sending while button is held.
     * This helps keep manual control alive while
     * the ESP32 safety layer remains authoritative.
     */
    state.manualCommandTimer =
        setInterval(
            () => {
                if (
                    state.manualButtonHeld
                ) {
                    sendManualCommand(
                        normalized
                    );
                }
            },
            CONFIG.manualCommandIntervalMs
        );
}


function stopManualCommand(
    sendStop = true
) {
    state.manualButtonHeld = false;

    clearInterval(
        state.manualCommandTimer
    );

    state.manualCommandTimer =
        null;

    state.manualCommand =
        "S";

    updateManualCommandUI(
        "S"
    );

    if (
        sendStop &&
        state.controlMode ===
        CONTROL_MODES.MANUAL
    ) {
        postManualControl(
            "S"
        );
    }
}


/* =========================================================
   MANUAL BUTTON INITIALIZATION
   ========================================================= */

function initializeManualControls() {
    const buttons =
        $$(".manual-button[data-command]");

    buttons.forEach(
        button => {
            const command =
                normalizeManualCommand(
                    button.dataset.command
                );

            /*
             * Pointer events avoid duplicate
             * mouse + touch events.
             */
            button.addEventListener(
                "pointerdown",
                event => {
                    event.preventDefault();

                    try {
                        button.setPointerCapture(
                            event.pointerId
                        );
                    } catch (_) {
                        /* Ignore unsupported capture */
                    }

                    if (command === "S") {
                        stopManualCommand(
                            true
                        );

                        return;
                    }

                    startManualCommand(
                        command
                    );
                }
            );

            button.addEventListener(
                "pointerup",
                event => {
                    event.preventDefault();

                    if (
                        command !== "S"
                    ) {
                        stopManualCommand(
                            true
                        );
                    }
                }
            );

            button.addEventListener(
                "pointercancel",
                () => {
                    if (
                        command !== "S"
                    ) {
                        stopManualCommand(
                            true
                        );
                    }
                }
            );

            button.addEventListener(
                "pointerleave",
                () => {
                    if (
                        state.manualButtonHeld &&
                        command !== "S"
                    ) {
                        stopManualCommand(
                            true
                        );
                    }
                }
            );
        }
    );
}


/* =========================================================
   KEYBOARD CONTROL
   ========================================================= */

function initializeKeyboardControls() {
    document.addEventListener(
        "keydown",
        event => {
            if (
                event.repeat
            ) {
                return;
            }

            const tagName =
                event.target?.tagName;

            /*
             * Do not steal keyboard input from
             * destination fields.
             */
            if (
                tagName === "INPUT" ||
                tagName === "TEXTAREA"
            ) {
                return;
            }

            const key =
                event.key.toLowerCase();

            const commands = {
                w: "F",
                arrowup: "F",

                s: "B",
                arrowdown: "B",

                a: "L",
                arrowleft: "L",

                d: "R",
                arrowright: "R"
            };

            if (
                key === " "
            ) {
                event.preventDefault();

                if (
                    state.controlMode ===
                    CONTROL_MODES.MANUAL
                ) {
                    stopManualCommand(
                        true
                    );
                }

                return;
            }

            const command =
                commands[key];

            if (
                command &&
                state.controlMode ===
                CONTROL_MODES.MANUAL
            ) {
                event.preventDefault();

                startManualCommand(
                    command
                );
            }
        }
    );


    document.addEventListener(
        "keyup",
        event => {
            const tagName =
                event.target?.tagName;

            if (
                tagName === "INPUT" ||
                tagName === "TEXTAREA"
            ) {
                return;
            }

            const key =
                event.key.toLowerCase();

            const movementKeys = [
                "w",
                "a",
                "s",
                "d",
                "arrowup",
                "arrowdown",
                "arrowleft",
                "arrowright"
            ];

            if (
                movementKeys.includes(key)
            ) {
                stopManualCommand(
                    true
                );
            }
        }
    );


    /*
     * Browser tab loses focus:
     * release manual command.
     */
    window.addEventListener(
        "blur",
        () => {
            stopManualCommand(
                true
            );
        }
    );


    document.addEventListener(
        "visibilitychange",
        () => {
            state.pageVisible =
                document.visibilityState ===
                "visible";

            if (
                !state.pageVisible
            ) {
                stopManualCommand(
                    true
                );
            }
        }
    );
}


/* =========================================================
   MODE BUTTONS
   ========================================================= */

function initializeModeControls() {
    dom.autoMode?.addEventListener(
        "click",
        switchToAuto
    );

    dom.manualMode?.addEventListener(
        "click",
        switchToManual
    );
}


/* =========================================================
   MISSION BUTTONS
   ========================================================= */

function initializeMissionControls() {
    dom.setDestination?.addEventListener(
        "click",
        setDestination
    );

    dom.startMission?.addEventListener(
        "click",
        startMission
    );

    dom.stopMission?.addEventListener(
        "click",
        stopMission
    );

    dom.clearLog?.addEventListener(
        "click",
        clearEventLog
    );
}


/* =========================================================
   TELEMETRY POLLING
   ========================================================= */

async function fetchTelemetry() {
    try {
        const response =
            await fetchWithTimeout(
                CONFIG.telemetryUrl,
                {
                    method: "GET",
                    cache: "no-store",
                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const raw =
            await response.json();

        const telemetry =
            normalizeTelemetry(
                raw
            );

        renderTelemetry(
            telemetry
        );

        setConnectionState(
            telemetry.online !== false
        );

    } catch (error) {
        console.warn(
            "Telemetry request failed:",
            error
        );

        setConnectionState(
            false
        );
    }
}


function startTelemetryPolling() {
    fetchTelemetry();

    clearInterval(
        state.pollTimer
    );

    state.pollTimer =
        setInterval(
            fetchTelemetry,
            CONFIG.pollIntervalMs
        );
}


/* =========================================================
   INITIAL DEFAULT UI
   ========================================================= */

function initializeDefaultUI() {
    setControlModeUI(
        CONTROL_MODES.AUTO
    );

    if (dom.manualCommandStatus) {
        dom.manualCommandStatus.textContent =
            "STOP";
    }

    if (dom.manualCommandFeedback) {
        dom.manualCommandFeedback.textContent =
            "MANUAL CONTROL READY";
    }

    if (dom.pathDecision) {
        dom.pathDecision.textContent =
            "—";
    }

    if (dom.pathFollowingState) {
        dom.pathFollowingState.textContent =
            "WAITING";
    }

    if (dom.obstacleState) {
        dom.obstacleState.textContent =
            "PATH CLEAR";
    }

    if (dom.navigationStage) {
        dom.navigationStage.textContent =
            "START";
    }

    if (dom.aprilTagNavigationState) {
        dom.aprilTagNavigationState.textContent =
            "NAVIGATING";
    }

    updateNavigationStages(
        "START"
    );
}


/* =========================================================
   STARTUP
   ========================================================= */

function initializeDashboard() {
    initializeDefaultUI();

    initializeChart();

    initializeModeControls();

    initializeMissionControls();

    initializeManualControls();

    initializeKeyboardControls();

    initializeMapClick();

    setDestinationUI(
        state.destination.x,
        state.destination.y
    );

    addEvent(
        "Dashboard initialized",
        "info"
    );

    startTelemetryPolling();
}


/* =========================================================
   DOM READY
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initializeDashboard,
        {
            once: true
        }
    );
} else {
    initializeDashboard();
}