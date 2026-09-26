import { Redirect } from "expo-router";
import { useApp } from "../src/state/appStore";

export default function Index() {
  const onboarded = useApp((s) => s.onboarded);
  return <Redirect href={onboarded ? "/map" : "/onboarding"} />;
}
