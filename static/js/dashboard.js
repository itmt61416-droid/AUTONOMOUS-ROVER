const distanceHistory = [];
const timeHistory = [];
let startTime = Date.now();

const chart = new Chart(document.getElementById("distanceChart"), {
    type: "line",
    data: {
        labels: timeHistory,
        datasets: [{
            label: "Distance (m)",
            data: distanceHistory,
            tension: 0.25
        }]
    },
    options: {
        responsive: true,
        animation: false,
        scales: {
            y: { beginAtZero: true }
        }
    }
});

async function updateTelemetry() {
    try {
        const response = await fetch("/api/telemetry");
        const data = await response.json();

        document.getElementById("connection").textContent =
            data.status || "CONNECTED";
        document.getElementById("command").textContent = data.command || "S";
        document.getElementById("distance").textContent =
            `${Number(data.distance || 0).toFixed(2)} m`;
        document.getElementById("front").textContent = `${data.front ?? "--"} cm`;
        document.getElementById("left").textContent = `${data.left ?? "--"} cm`;
        document.getElementById("right").textContent = `${data.right ?? "--"} cm`;
        document.getElementById("rear").textContent = `${data.rear ?? "--"} cm`;
        document.getElementById("tag").textContent =
            data.apriltag === null ? "NOT DETECTED" : `ID ${data.apriltag}`;

        const seconds = ((Date.now() - startTime) / 1000).toFixed(0);
        timeHistory.push(`${seconds}s`);
        distanceHistory.push(Number(data.distance || 0));

        if (timeHistory.length > 30) {
            timeHistory.shift();
            distanceHistory.shift();
        }
        chart.update();
    } catch (error) {
        document.getElementById("connection").textContent = "DISCONNECTED";
    }
}

setInterval(updateTelemetry, 500);
updateTelemetry();
