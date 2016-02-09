#!/bin/bash
for (( i=0; i<5; i++ )); do
   node uber_worker.js $i &
done
