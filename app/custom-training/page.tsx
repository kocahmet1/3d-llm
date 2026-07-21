import type { Metadata } from "next";
import { CustomTrainingChamber } from "../components/custom-training/CustomTrainingChamber";

export const metadata: Metadata = {
  title: "Custom Training Chamber",
  description:
    "Prepare a text corpus, train a small language model locally, and monitor every real optimizer step.",
};

export default function CustomTrainingPage() {
  return <CustomTrainingChamber />;
}
