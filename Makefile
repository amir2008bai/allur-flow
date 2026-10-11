# Короткие команды (Linux/macOS/Git Bash): make run | make verify | make test | make docker | make real
run:
	./start.sh
verify:
	python verify.py
test:
	cd backend && python -m pytest -q
real:
	cd validation/real-factory && python validate_garment.py
docker:
	docker compose up -d --build
.PHONY: run verify test real docker
