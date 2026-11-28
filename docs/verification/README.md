# Hand-calculation verification

One file per model, written by `stm-verification-writer` (see [AGENTS.md](../../AGENTS.md)).
Each file is an independent, clause-cited hand calculation that a checking engineer can follow line by line,
compared with STM-Lab's output.

## Layout of each file (`<template>.md`)
1. Inputs (SI: mm, kN, MPa) and the benchmark case file used.
2. Truss geometry and node coordinates.
3. Member forces by joint equilibrium.
4. Strut, tie, node, bearing and anchorage checks, each with its ACI 318 / AASHTO LRFD clause.
5. Table: hand calc vs STM-Lab, with the difference.
6. References with page numbers.

## Status
| Model | File | Status |
|---|---|---|
| Deep beam | – | to do |
| Corbel | – | to do |
| Dapped end | – | to do |
| Frame corner | – | to do |
| Footings (pile / spread / abutment) | – | to do |
| Two-pile cap | – | to do |
| Four-pile cap (3D) | – | to do |
| Pier cap / hammerhead | – | to do |
