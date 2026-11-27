import RoastApp from "@/components/roast-app";

export default function Home() {
  return <RoastApp accessCodeRequired={Boolean(process.env.ANALYSIS_ACCESS_CODE)} />;
}
