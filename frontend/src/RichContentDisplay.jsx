import React from "react";
import DOMPurify from "dompurify";
import parse from "html-react-parser";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

function ChartBlock({ data }) {
  const chartData = typeof data === "string" ? JSON.parse(data) : data;
  const { type = "bar", labels = [], data: values = [] } = chartData;
  const datasets = [
    {
      label: chartData.label || "Data",
      data: values.map(Number),
      backgroundColor:
        type === "pie"
          ? [
              "rgba(59, 130, 246, 0.8)",
              "rgba(34, 197, 94, 0.8)",
              "rgba(234, 179, 8, 0.8)",
              "rgba(239, 68, 68, 0.8)",
              "rgba(168, 85, 247, 0.8)",
            ]
          : "rgba(59, 130, 246, 0.7)",
      borderColor: "rgba(59, 130, 246, 1)",
      borderWidth: 1,
    },
  ];
  const options = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: type === "pie" },
      title: { display: !!chartData.title, text: chartData.title },
    },
    scales:
      type !== "pie"
        ? {
            y: { beginAtZero: true },
          }
        : undefined,
  };
  const chartConfig = {
    labels,
    datasets,
  };
  if (type === "line") return <Line data={chartConfig} options={options} />;
  if (type === "pie") return <Pie data={chartConfig} options={options} />;
  return <Bar data={chartConfig} options={options} />;
}

export function RichContentDisplay({ html }) {
  if (!html) return null;
  const sanitized = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-chart"],
    ALLOWED_ATTR: [
      "class",
      "href",
      "target",
      "data-chart",
      "style",
      "align",
      "colspan",
      "rowspan",
    ],
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "div",
      "span",
    ],
  });

  const replace = (domNode) => {
    if (
      domNode.attribs?.class?.includes("assignment-chart") &&
      domNode.attribs?.["data-chart"]
    ) {
      try {
        return (
          <div key={Math.random()} className="chart-container">
            <ChartBlock data={domNode.attribs["data-chart"]} />
          </div>
        );
      } catch (e) {
        return null;
      }
    }
    return undefined;
  };

  return (
    <div className="rich-content-display">{parse(sanitized, { replace })}</div>
  );
}
