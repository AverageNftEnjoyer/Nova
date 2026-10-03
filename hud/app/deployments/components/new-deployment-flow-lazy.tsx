"use client"

import dynamic from "next/dynamic"

import type { NewDeploymentFlowProps } from "./new-deployment-flow"

/** Loads the flow's code on demand; call on hover/focus of an entry point so opening it is instant. */
export const preloadNewDeploymentFlow = () => import("./new-deployment-flow")

export const LazyNewDeploymentFlow = dynamic<NewDeploymentFlowProps>(
  () => preloadNewDeploymentFlow().then((module) => module.NewDeploymentFlow),
  { ssr: false },
)
