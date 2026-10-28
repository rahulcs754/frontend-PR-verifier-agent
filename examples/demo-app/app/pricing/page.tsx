const plans = [
  { name: "Free", price: "$0", features: ["1 project", "Community support"] },
  { name: "Pro", price: "$12", features: ["10 projects", "Email support"] },
  { name: "Team", price: "$49", features: ["Unlimited projects", "Priority support"] },
];

export default function PricingPage() {
  return (
    <section>
      <h1>Pricing</h1>
      <div className="plans">
        {plans.map((plan) => (
          <article key={plan.name} className="plan">
            <h2>{plan.name}</h2>
            <p className="price">{plan.price}/mo</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
