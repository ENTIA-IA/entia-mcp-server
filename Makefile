.PHONY: setup test run-funnel-api

setup:
	python -m pip install --upgrade pip
	python -m pip install -e .

test:
	python -m unittest discover -s tests

run-funnel-api:
	./scripts/run_funnel_api.sh
