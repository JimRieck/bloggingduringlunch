var builder = DistributedApplication.CreateBuilder(args);

builder.AddNpmApp("web", "../web", "dev")
    .WithHttpEndpoint(port: 5173, env: "PORT")
    .WithExternalHttpEndpoints();

builder.Build().Run();
